// ===========================================================================
//  Musical Impact Smart TV - sync_manager.lsl
// ---------------------------------------------------------------------------
//  Holds the in-world view of what the TV is playing, and keeps the object and
//  the cloud agreeing about it.
//
//  BE CLEAR ABOUT WHAT THIS SCRIPT CAN SYNCHRONISE
//    Not very much on its own, and that is not a shortcoming to hide. A script
//    cannot read the playhead of a video inside a media face - there is no API
//    for it and never has been. Position synchronisation happens in the web
//    app, between browsers, over the WebSocket the backend provides.
//
//    What this script contributes is the part only it can do:
//      * remembers the last known state so the TV can describe itself with no
//        cloud at all (hover text, the menu, a newly arrived viewer)
//      * relays local button presses into the shared state
//      * restores the last media on rez, if resume is enabled
//
//  So: browsers synchronise with each other, and this keeps the OBJECT honest
//  about what they are doing.
// ===========================================================================

integer MI_NET_SEND  = 100;
integer MI_NET_RECV  = 101;
integer MI_NET_STATUS= 102;
integer MI_CFG_GET   = 120;
integer MI_CFG_VALUE = 121;
integer MI_SYNC_CMD  = 160;
integer MI_SYNC_STATE= 161;

string  playback = "idle";
string  title    = "";
string  source   = "";
integer external = FALSE;
integer viewers  = 0;
string  hostName = "";

integer showHover = TRUE;
integer online    = FALSE;

// Hover text is the only status display an object has when the screen itself
// is showing somebody else website. Kept short; a wall of text over a TV is
// worse than none.
updateHover()
{
    if (!showHover)
    {
        llSetText("", <1,1,1>, 0.0);
        return;
    }

    string line = "Musical Impact";
    if (playback == "playing" && title != "") line += "\n" + title;
    else if (playback == "paused") line += "\nPaused";
    else if (external) line += "\nBrowsing";

    if (viewers > 0) line += "\n" + (string)viewers + " watching";
    if (!online) line += "\n(local mode)";

    llSetText(line, <1.0, 0.18, 0.18>, 1.0);
}

// Remember enough to describe ourselves after a reset, and to resume.
persist()
{
    llLinksetDataWrite("last_title", title);
    llLinksetDataWrite("last_source", source);
}

default
{
    state_entry()
    {
        llMessageLinked(LINK_SET, MI_CFG_GET, "sync_enabled", NULL_KEY);
        title  = llLinksetDataRead("last_title");
        source = llLinksetDataRead("last_source");
        updateHover();
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_NET_STATUS)
        {
            online = (str == "online");
            updateHover();
            return;
        }

        // Authoritative state from the backend.
        if (num == MI_NET_RECV)
        {
            if (llJsonGetValue(str, ["c"]) != "state") return;

            string st = llJsonGetValue(str, ["st"]);
            if (st != JSON_INVALID && st != "") playback = st;

            string t = llJsonGetValue(str, ["ttl"]);
            if (t != JSON_INVALID) title = t;

            string s = llJsonGetValue(str, ["src"]);
            if (s != JSON_INVALID) source = s;

            string e = llJsonGetValue(str, ["ext"]);
            if (e != JSON_INVALID) external = ((integer)e == 1);

            string n = llJsonGetValue(str, ["n"]);
            if (n != JSON_INVALID) viewers = (integer)n;

            string h = llJsonGetValue(str, ["host"]);
            if (h != JSON_INVALID) hostName = h;

            persist();
            updateHover();
            llMessageLinked(LINK_SET, MI_SYNC_STATE, str, NULL_KEY);
            return;
        }

        // A local command, from a menu or the HUD, going the other way.
        if (num == MI_SYNC_CMD)
        {
            integer bar = llSubStringIndex(str, "|");
            string action = str;
            string value = "";
            if (bar > 0)
            {
                action = llGetSubString(str, 0, bar - 1);
                value  = llGetSubString(str, bar + 1, -1);
            }

            // Optimistic local update so the hover text responds immediately
            // even when the cloud is slow or gone. The backend answer, when it
            // arrives, overwrites this.
            if (action == "play")  playback = "playing";
            if (action == "pause") playback = "paused";
            if (action == "stop")  playback = "stopped";
            updateHover();

            llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/command|"
                + llList2Json(JSON_OBJECT, [
                    "tvId", (string)llGetKey(),
                    "c",    action,
                    "v",    value,
                    "k",    (string)id
                ]), id);
        }
    }

    on_rez(integer p)
    {
        // Never resume as playing: a TV that starts blasting audio the moment
        // it is rezzed into a quiet room is a bad neighbour.
        playback = "paused";
        updateHover();
    }
}
