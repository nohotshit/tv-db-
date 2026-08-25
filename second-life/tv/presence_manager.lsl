// ===========================================================================
//  Musical Impact Smart TV - presence_manager.lsl
// ---------------------------------------------------------------------------
//  Detects avatars near the TV and reports them to the backend.
//
//  WHY llGetAgentList AND NOT llSensorRepeat
//    A repeating sensor is a scheduled sim task that runs whether or not
//    anything changed, and it is one of the classic reasons a script gets
//    blamed for region lag. llGetAgentList reads a list the simulator already
//    maintains, costs nothing comparable, and covers the whole parcel or
//    region rather than a 96 metre cone. Requirement 37 asks for no constant
//    sensor scanning; this is how that is honoured.
//
//  The list is only reported when it CHANGES. A room where nobody comes or
//  goes produces no network traffic at all.
//
//  The group flag matters: llSameGroup is the only place in the entire system
//  where group membership can be established, so it is captured here and the
//  backend stores the answer for its own permission checks.
//
//  PRIVACY: names and keys of avatars standing at the TV, nothing else. No
//  positions, no tracking, no history. Entries are dropped as soon as someone
//  walks away.
// ===========================================================================

integer MI_NET_SEND  = 100;
integer MI_PRESENCE  = 140;
integer MI_CFG_GET   = 120;
integer MI_CFG_VALUE = 121;

integer INTERVAL = 12;              // seconds between checks
integer enabled  = TRUE;
float   range    = 20.0;
string  lastSignature;              // used to suppress unchanged reports

scan()
{
    if (!enabled) return;

    // Parcel scope, not region: a TV should notice the people in the room,
    // not everyone on the sim.
    list agents = llGetAgentList(AGENT_LIST_PARCEL, []);
    vector here = llGetPos();

    list report;
    string signature;
    integer i;
    integer n = llGetListLength(agents);
    if (n > 40) n = 40;                 // keep the payload inside the body cap

    for (i = 0; i < n; i++)
    {
        key av = llList2Key(agents, i);
        list details = llGetObjectDetails(av, [OBJECT_POS]);
        vector pos = llList2Vector(details, 0);

        if (llVecDist(pos, here) <= range)
        {
            integer sameGroup = 0;
            if (llSameGroup(av)) sameGroup = 1;

            report += [ (string)av + "|" + llGetDisplayName(av) + "|" + (string)sameGroup ];
            signature += (string)av + (string)sameGroup;
        }
    }

    // Nothing changed since last time: say nothing. This is the difference
    // between a TV that costs one request every twelve seconds forever and one
    // that costs nothing while a room sits empty.
    if (signature == lastSignature) return;
    lastSignature = signature;

    llMessageLinked(LINK_SET, MI_PRESENCE, llDumpList2String(report, ","), NULL_KEY);

    llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/presence|"
        + llList2Json(JSON_OBJECT, [
            "tvId", (string)llGetKey(),
            "a",    llList2Json(JSON_ARRAY, report)
        ]), NULL_KEY);
}

default
{
    state_entry()
    {
        llMessageLinked(LINK_SET, MI_CFG_GET, "detect_range", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "messaging", NULL_KEY);
        llSetTimerEvent(INTERVAL);
    }

    timer()
    {
        scan();
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num != MI_CFG_VALUE) return;

        integer bar = llSubStringIndex(str, "|");
        if (bar < 1) return;
        string k = llGetSubString(str, 0, bar - 1);
        string v = llGetSubString(str, bar + 1, -1);

        if (k == "detect_range")
        {
            range = (float)v;
            // 96 metres is the practical ceiling for avatar detection, and
            // beyond the parcel it stops being meaningful anyway.
            if (range <= 0.0) range = 20.0;
            if (range > 96.0) range = 96.0;
        }
        else if (k == "messaging")
        {
            enabled = (v != "0");
            if (!enabled) lastSignature = "";
        }
    }

    changed(integer c)
    {
        if (c & CHANGED_REGION || c & CHANGED_REGION_START)
        {
            // Everyone we knew about is, as far as we are concerned, gone.
            lastSignature = "";
        }
    }
}
