// ===========================================================================
//  Musical Impact Smart TV - idle_manager.lsl
// ---------------------------------------------------------------------------
//  Returns the TV to the idle screen after a period with no activity, and
//  wakes it on the first sign of life.
//
//  TWO WAYS TO SHOW THE IDLE SCREEN, and it matters which one is available:
//
//   1. The web idle screen. The frontend has an idle route showing the logo,
//      the clock and the prompt. Preferred, because the logo and clock come
//      from one place rather than being maintained twice.
//
//   2. A texture on the face. Used when there is no frontend url configured,
//      or the cloud is unreachable and the interface would not load anyway.
//      This is the reason logo_uuid exists as a setting: a TV with no network
//      should still show its own branding rather than a blank grey prim.
//
//  Never idles out over something that is playing. A television that blanks
//  itself in the middle of a film is broken, not power saving.
// ===========================================================================

integer MI_NET_RECV   = 101;
integer MI_MOAP_HOME  = 111;
integer MI_MOAP_IDLE  = 112;
integer MI_CFG_GET    = 120;
integer MI_CFG_VALUE  = 121;
integer MI_ACTIVITY   = 170;
integer MI_IDLE_ENTER = 171;
integer MI_IDLE_EXIT  = 172;
integer MI_SYNC_STATE = 161;

integer enabled  = TRUE;
integer timeout  = 300;
integer idle     = FALSE;
integer lastSeen;
string  logoUUID = "";
integer face     = 0;
string  playback = "idle";

// The face texture used while idle, when the web idle screen is not available.
showLogoTexture()
{
    if (logoUUID == "") return;
    llClearLinkMedia(LINK_THIS, face);
    llSetLinkPrimitiveParamsFast(LINK_THIS, [
        PRIM_TEXTURE, face, (key)logoUUID, <1.0, 1.0, 0.0>, ZERO_VECTOR, 0.0,
        PRIM_COLOR, face, <1.0, 1.0, 1.0>, 1.0,
        PRIM_FULLBRIGHT, face, TRUE
    ]);
}

goIdle()
{
    if (idle || !enabled) return;
    // Playing content always wins over the idle timer.
    if (playback == "playing") { lastSeen = llGetUnixTime(); return; }

    idle = TRUE;

    if (llLinksetDataRead("frontend_url") != "")
    {
        llMessageLinked(LINK_SET, MI_MOAP_IDLE, "", NULL_KEY);
    }
    else
    {
        showLogoTexture();
    }
    llMessageLinked(LINK_SET, MI_IDLE_ENTER, "", NULL_KEY);
}

wake()
{
    lastSeen = llGetUnixTime();
    if (!idle) return;

    idle = FALSE;
    llMessageLinked(LINK_SET, MI_MOAP_HOME, "", NULL_KEY);
    llMessageLinked(LINK_SET, MI_IDLE_EXIT, "", NULL_KEY);
}

default
{
    state_entry()
    {
        lastSeen = llGetUnixTime();
        llMessageLinked(LINK_SET, MI_CFG_GET, "idle_enabled", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "idle_timeout", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "logo_uuid", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "media_face", NULL_KEY);
        // Ten seconds is fine granularity for a timeout measured in minutes,
        // and one slow timer is cheaper than a precise one.
        llSetTimerEvent(10.0);
    }

    timer()
    {
        if (!enabled || idle) return;
        if (llGetUnixTime() - lastSeen >= timeout) goIdle();
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_ACTIVITY) { wake(); return; }

        if (num == MI_SYNC_STATE)
        {
            string st = llJsonGetValue(str, ["st"]);
            if (st != JSON_INVALID) playback = st;
            // Anything actually happening counts as activity.
            if (playback == "playing") lastSeen = llGetUnixTime();
            return;
        }

        if (num == MI_NET_RECV)
        {
            // Only an actual COMMAND counts as somebody using the TV.
            //
            // net_bridge forwards every response body, including the routine
            // poll that runs every thirty seconds whether anyone is here or
            // not. Waking on all of them would mean the idle screen never
            // engaged - the TV would keep itself awake talking to itself.
            // Commands carry a "c" field; replies to our own polling do not.
            if (llJsonGetValue(str, ["c"]) != JSON_INVALID) wake();
            return;
        }

        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            string k = llGetSubString(str, 0, bar - 1);
            string v = llGetSubString(str, bar + 1, -1);

            if (k == "idle_enabled")
            {
                enabled = (v != "0");
                if (!enabled && idle) wake();
            }
            else if (k == "idle_timeout")
            {
                timeout = (integer)v;
                if (timeout < 30) timeout = 30;
            }
            else if (k == "logo_uuid")  logoUUID = v;
            else if (k == "media_face") face = (integer)v;
        }
    }

    touch_start(integer n)
    {
        wake();
    }

    on_rez(integer p)
    {
        lastSeen = llGetUnixTime();
        idle = FALSE;
    }
}
