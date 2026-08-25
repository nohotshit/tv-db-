// ===========================================================================
//  Musical Impact Smart TV - settings_manager.lsl
// ---------------------------------------------------------------------------
//  Owns every persistent setting on the Second Life side, stored in Linkset
//  Data (llLinksetDataWrite / llLinksetDataRead).
//
//  Why Linkset Data rather than the cloud:
//    it survives a script reset, being taken into inventory and re-rezzed, and
//    a total backend outage. The TV must still know its own timezone, its
//    permission mode and where "home" is when Render is unreachable, which is
//    requirement 36 in practice.
//
//  What deliberately does NOT live here:
//    anything the database already owns - favorites, history, per-user
//    preferences. Duplicating those in world would mean two sources of truth
//    and a guaranteed disagreement. Linkset Data holds configuration only.
//
//  Budget: Linkset Data is 128 KB for the whole linkset, keys and values
//  together. What follows uses a few hundred bytes.
// ===========================================================================

integer MI_CFG_GET   = 120;
integer MI_CFG_VALUE = 121;
integer MI_CFG_SET   = 122;

string  NOTECARD = "TV Config";
key     ncQuery;
integer ncLine;

// Defaults, applied on first run and by the Reset option in the owner menu.
list DEFAULTS = [
    "backend_url",    "",
    "frontend_url",   "",
    "shared_secret",  "",
    "device_secret",  "",
    "timezone",       "America/New_York",
    "time_format",    "12",
    "date_format",    "MM/DD/YYYY",
    "permission_mode","owner",
    "idle_timeout",   "300",
    "idle_enabled",   "1",
    "logo_uuid",      "",
    "movies_url",     "https://flixbaba.tv/",
    "home_url",       "https://duckduckgo.com/",
    "media_face",     "0",
    "sync_enabled",   "1",
    "messaging",      "1",
    "detect_range",   "20",
    "debug",          "0"
];

string get(string k)
{
    string v = llLinksetDataRead(k);
    if (v == "")
    {
        integer i = llListFindList(DEFAULTS, [k]);
        if (i != -1) return llList2String(DEFAULTS, i + 1);
    }
    return v;
}

set(string k, string v)
{
    // A key with an empty value is a deleted key, not a stored blank. Keeping
    // empties would waste the 128 KB budget on nothing.
    if (v == "") llLinksetDataDelete(k);
    else llLinksetDataWrite(k, v);
}

applyDefaults(integer force)
{
    integer i;
    integer n = llGetListLength(DEFAULTS);
    for (i = 0; i < n; i += 2)
    {
        string k = llList2String(DEFAULTS, i);
        string v = llList2String(DEFAULTS, i + 1);
        if (force || llLinksetDataRead(k) == "")
        {
            if (v != "") llLinksetDataWrite(k, v);
        }
    }
}

broadcast(string k, key requester)
{
    llMessageLinked(LINK_SET, MI_CFG_VALUE, k + "|" + get(k), requester);
}

// ---------------------------------------------------------------------------
//  Notecard loading
// ---------------------------------------------------------------------------
//  The notecard is how secrets reach the object without being typed into a
//  script. It is read once at start, copied into Linkset Data, and then the
//  owner can delete it from the contents - which is the recommended step,
//  because anyone with copy permission on the object could otherwise read it.
//
//  Format, one per line:   key = value      (# starts a comment)
// ---------------------------------------------------------------------------
readNotecard()
{
    if (llGetInventoryType(NOTECARD) != INVENTORY_NOTECARD)
    {
        llOwnerSay("Smart TV: no notecard named \"" + NOTECARD + "\" found. "
                 + "Using stored settings.");
        return;
    }
    ncLine = 0;
    ncQuery = llGetNotecardLine(NOTECARD, ncLine);
}

default
{
    state_entry()
    {
        applyDefaults(FALSE);
        readNotecard();
    }

    dataserver(key query, string data)
    {
        if (query != ncQuery) return;

        if (data == EOF)
        {
            llOwnerSay("Smart TV: configuration loaded. "
                     + "You can now delete the notecard from the object contents.");
            // Tell everyone the values they were waiting on.
            broadcast("backend_url", NULL_KEY);
            broadcast("shared_secret", NULL_KEY);
            broadcast("device_secret", NULL_KEY);
            broadcast("frontend_url", NULL_KEY);
            broadcast("permission_mode", NULL_KEY);
            return;
        }

        string line = llStringTrim(data, STRING_TRIM);
        if (line != "" && llGetSubString(line, 0, 0) != "#")
        {
            integer eq = llSubStringIndex(line, "=");
            if (eq > 0)
            {
                string k = llStringTrim(llGetSubString(line, 0, eq - 1), STRING_TRIM);
                string val = llStringTrim(llGetSubString(line, eq + 1, -1), STRING_TRIM);
                set(k, val);
            }
        }

        ncLine++;
        ncQuery = llGetNotecardLine(NOTECARD, ncLine);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_CFG_GET)
        {
            broadcast(str, id);
            return;
        }

        if (num == MI_CFG_SET)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            string k = llGetSubString(str, 0, bar - 1);
            string v = llGetSubString(str, bar + 1, -1);
            set(k, v);
            broadcast(k, NULL_KEY);
            return;
        }

        // settings_manager also answers its own MI_CFG_VALUE writes, which is
        // how net_bridge hands back the device secret it was issued.
        if (num == MI_CFG_VALUE && sender != llGetLinkNumber())
        {
            integer bar2 = llSubStringIndex(str, "|");
            if (bar2 < 1) return;
            string k2 = llGetSubString(str, 0, bar2 - 1);
            if (k2 == "device_secret")
            {
                set(k2, llGetSubString(str, bar2 + 1, -1));
            }
        }
    }

    changed(integer c)
    {
        if (c & CHANGED_INVENTORY)
        {
            readNotecard();
        }
        if (c & CHANGED_OWNER)
        {
            // A new owner should not inherit the previous pairing.
            llLinksetDataDelete("device_secret");
            applyDefaults(FALSE);
        }
    }
}
