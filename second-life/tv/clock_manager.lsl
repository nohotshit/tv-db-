// ===========================================================================
//  Musical Impact Smart TV - clock_manager.lsl
// ---------------------------------------------------------------------------
//  Local time for the object itself: hover text, menus, and anything the TV
//  needs to say about the time when there is no cloud and no screen.
//
//  THE HONEST LIMITATION
//    LSL has no timezone database. There is no llConvertToTimezone, and the
//    IANA rules that make "America/New_York" mean UTC-5 in January and UTC-4
//    in July simply are not present in the scripting environment. The web
//    interface does this properly because a browser ships Intl and real tzdata;
//    a script cannot.
//
//    So this script implements the ONE set of rules it can implement correctly:
//    the United States daylight saving rule in force since 2007 - forward on
//    the second Sunday in March, back on the first Sunday in November, both at
//    two o clock local. That covers every US zone requirement 19 lists, plus
//    Arizona and Hawaii, which never shift, plus UTC.
//
//    Any other zone falls back to Second Life time, and says so rather than
//    printing a wrong number. Zones outside this set are handled on screen,
//    where the tooling actually exists.
//
//    Note also that these are 32 bit UNIX seconds, so this arithmetic is good
//    until 2038 like everything else built on llGetUnixTime.
// ===========================================================================

integer MI_CFG_GET   = 120;
integer MI_CFG_VALUE = 121;
integer MI_CLOCK_REQ = 200;
integer MI_CLOCK_VAL = 201;

string zone       = "America/New_York";
string timeFormat = "12";
string dateFormat = "MM/DD/YYYY";

// Standard (winter) offset in seconds, and whether the zone observes DST.
integer stdOffset(string z)
{
    if (z == "America/New_York")    return -5 * 3600;
    if (z == "America/Chicago")     return -6 * 3600;
    if (z == "America/Denver")      return -7 * 3600;
    if (z == "America/Phoenix")     return -7 * 3600;
    if (z == "America/Los_Angeles") return -8 * 3600;
    if (z == "America/Anchorage")   return -9 * 3600;
    if (z == "Pacific/Honolulu")    return -10 * 3600;
    return 0;                                   // UTC, and the fallback
}

integer observesDST(string z)
{
    if (z == "America/Phoenix")  return FALSE;  // Arizona does not shift
    if (z == "Pacific/Honolulu") return FALSE;  // neither does Hawaii
    if (z == "UTC")              return FALSE;
    return TRUE;
}

// ---------------------------------------------------------------------------
//  Calendar arithmetic
// ---------------------------------------------------------------------------
//  Days since the epoch for a civil date, by the usual era based method. LSL
//  integer division truncates toward zero, which is correct here because every
//  value involved is positive for any year this TV will see.
// ---------------------------------------------------------------------------
integer daysFromCivil(integer y, integer m, integer d)
{
    if (m <= 2) y -= 1;
    integer era = y / 400;
    integer yoe = y - era * 400;
    integer mp  = (m + 9) % 12;
    integer doy = (153 * mp + 2) / 5 + d - 1;
    integer doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

// 0 = Sunday. Unix day 0 was a Thursday, hence the + 4.
integer dayOfWeek(integer unixDay)
{
    return (unixDay + 4) % 7;
}

// The unix second at which US daylight saving begins in a given year:
// the second Sunday in March, at 02:00 local standard time.
integer dstStart(integer year, integer offset)
{
    integer firstDay = daysFromCivil(year, 3, 1);
    integer dow = dayOfWeek(firstDay);
    integer firstSunday = 1 + ((7 - dow) % 7);
    integer secondSunday = firstSunday + 7;
    return daysFromCivil(year, 3, secondSunday) * 86400 + 7200 - offset;
}

// And when it ends: the first Sunday in November at 02:00 local DAYLIGHT time,
// which is why the offset used here already includes the extra hour.
integer dstEnd(integer year, integer offset)
{
    integer firstDay = daysFromCivil(year, 11, 1);
    integer dow = dayOfWeek(firstDay);
    integer firstSunday = 1 + ((7 - dow) % 7);
    return daysFromCivil(year, 11, firstSunday) * 86400 + 7200 - (offset + 3600);
}

// Year for a unix time, found by stepping from a close guess rather than
// looping from 1970.
integer yearOf(integer unix)
{
    integer guess = 1970 + (unix / 31556952);
    while (daysFromCivil(guess, 1, 1) * 86400 > unix) guess--;
    while (daysFromCivil(guess + 1, 1, 1) * 86400 <= unix) guess++;
    return guess;
}

integer offsetNow(integer unix)
{
    integer base = stdOffset(zone);
    if (!observesDST(zone)) return base;

    integer y = yearOf(unix + base);
    if (unix >= dstStart(y, base) && unix < dstEnd(y, base)) return base + 3600;
    return base;
}

string abbrev(integer unix)
{
    integer base = stdOffset(zone);
    integer isDst = (offsetNow(unix) != base);

    if (zone == "America/New_York")    { if (isDst) return "EDT"; return "EST"; }
    if (zone == "America/Chicago")     { if (isDst) return "CDT"; return "CST"; }
    if (zone == "America/Denver")      { if (isDst) return "MDT"; return "MST"; }
    if (zone == "America/Phoenix")     return "MST";
    if (zone == "America/Los_Angeles") { if (isDst) return "PDT"; return "PST"; }
    if (zone == "America/Anchorage")   { if (isDst) return "AKDT"; return "AKST"; }
    if (zone == "Pacific/Honolulu")    return "HST";
    return "UTC";
}

string pad2(integer n)
{
    if (n < 10) return "0" + (string)n;
    return (string)n;
}

// Formats the current local time in the configured zone.
string formatNow()
{
    integer unix = llGetUnixTime();
    integer local = unix + offsetNow(unix);

    integer secOfDay = local % 86400;
    if (secOfDay < 0) secOfDay += 86400;

    integer hour = secOfDay / 3600;
    integer minute = (secOfDay % 3600) / 60;

    if (timeFormat == "24")
    {
        return pad2(hour) + ":" + pad2(minute) + " " + abbrev(unix);
    }

    string meridiem = "AM";
    integer h12 = hour;
    if (hour >= 12) { meridiem = "PM"; h12 = hour - 12; }
    if (h12 == 0) h12 = 12;

    return (string)h12 + ":" + pad2(minute) + " " + meridiem + " " + abbrev(unix);
}

string formatDate()
{
    integer unix = llGetUnixTime();
    integer local = unix + offsetNow(unix);
    integer days = local / 86400;

    // Walk back from the year to the month and day.
    integer y = yearOf(local);
    integer m = 1;
    while (m < 12 && daysFromCivil(y, m + 1, 1) <= days) m++;
    integer d = days - daysFromCivil(y, m, 1) + 1;

    if (dateFormat == "DD/MM/YYYY") return pad2(d) + "/" + pad2(m) + "/" + (string)y;
    if (dateFormat == "YYYY-MM-DD") return (string)y + "-" + pad2(m) + "-" + pad2(d);
    return pad2(m) + "/" + pad2(d) + "/" + (string)y;
}

default
{
    state_entry()
    {
        llMessageLinked(LINK_SET, MI_CFG_GET, "timezone", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "time_format", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "date_format", NULL_KEY);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_CLOCK_REQ)
        {
            llMessageLinked(LINK_SET, MI_CLOCK_VAL,
                formatNow() + "|" + formatDate(), id);
            if (id != NULL_KEY)
            {
                llRegionSayTo(id, 0, "Smart TV: " + formatNow()
                                   + " on " + formatDate() + ".");
            }
            return;
        }

        if (num != MI_CFG_VALUE) return;

        integer bar = llSubStringIndex(str, "|");
        if (bar < 1) return;
        string k = llGetSubString(str, 0, bar - 1);
        string v = llGetSubString(str, bar + 1, -1);

        if (k == "timezone" && v != "")
        {
            zone = v;
            if (stdOffset(zone) == 0 && zone != "UTC")
            {
                // A zone we cannot compute. Say so once, plainly, rather than
                // quietly showing the wrong time.
                llOwnerSay("Smart TV: " + zone + " has no in-world rules "
                         + "available, so object side times will use UTC. "
                         + "The on screen clock handles it correctly.");
            }
        }
        else if (k == "time_format" && v != "") timeFormat = v;
        else if (k == "date_format" && v != "") dateFormat = v;
    }
}
