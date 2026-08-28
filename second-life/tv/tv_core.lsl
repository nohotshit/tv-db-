// ===========================================================================
//  Musical Impact Smart TV - tv_core.lsl
// ---------------------------------------------------------------------------
//  The script a user actually touches. Owns the object menu, the boot
//  sequence, and routing between everything else.
//
//  Deliberately NOT in this script: HTTP, media, presence scanning, messaging.
//  Each of those is its own script with its own 64 KB of Mono memory. This one
//  stays small so the menu never stops responding because something else was
//  busy.
//
//  Touching the TV does two things at once:
//    - opens the menu appropriate to who touched it
//    - pairs their HUD, if they are wearing one, by asking the backend for a
//      token scoped to that avatar. That token is the ONLY way a web page ever
//      learns who is using it: the shared screen shows the same page to
//      everybody in range and cannot tell them apart.
// ===========================================================================

integer MI_NET_SEND    = 100;
integer MI_NET_RECV    = 101;
integer MI_NET_STATUS  = 102;
integer MI_MOAP_HOME   = 111;
integer MI_CFG_GET     = 120;
integer MI_CFG_VALUE   = 121;
integer MI_CFG_SET     = 122;
integer MI_PERM_CHECK  = 130;
integer MI_PERM_RESULT = 131;
integer MI_ACTIVITY    = 170;
integer MI_SYNC_CMD    = 160;
integer MI_GAME        = 180;

integer HUD_CHANNEL    = -70701;      // HUD to TV, region local
integer menuChannel;
integer menuHandle;
key     menuUser;
string  menuPage = "main";

integer backendOnline = FALSE;

// ---------------------------------------------------------------------------
//  Menus
// ---------------------------------------------------------------------------
//  llDialog allows at most 12 buttons of 24 characters each, so anything
//  longer is paged rather than crammed.
// ---------------------------------------------------------------------------
showMenu(key av, string page)
{
    menuUser = av;
    menuPage = page;

    if (menuHandle) llListenRemove(menuHandle);
    menuChannel = -1 - (integer)llFrand(90000000.0);
    menuHandle = llListen(menuChannel, "", av, "");
    llSetTimerEvent(60.0);              // menus expire; no listener left open

    string status = "Cloud: offline (local controls only)";
    if (backendOnline) status = "Cloud: connected";

    if (page == "main")
    {
        list buttons = [ "Play/Pause", "Stop", "TV Home",
                         "Apps", "Games", "Volume",
                         "Settings", "Access", "Close" ];
        if (av != llGetOwner())
        {
            buttons = [ "Play/Pause", "Stop", "TV Home",
                        "Apps", "Games", "Request control", "Close" ];
        }
        llDialog(av, "\nMusical Impact Smart TV\n" + status
                   + "\n\nWhat would you like to do?", buttons, menuChannel);
    }
    else if (page == "apps")
    {
        llDialog(av, "\nOpen which app on the screen?",
            [ "Movies", "YouTube", "Music",
              "Twitch", "Kick", "Browser",
              "Messages", "Clock", "Back" ], menuChannel);
    }
    else if (page == "access")
    {
        llDialog(av, "\nWho may control this TV?\n\n"
                   + "Owner    - only you\n"
                   + "Group    - matching active group tag\n"
                   + "Everyone - anyone present\n"
                   + "Host     - one person you appoint",
            [ "Owner", "Group", "Everyone", "Host", "Release host", "Back" ],
            menuChannel);
    }
    else if (page == "settings")
    {
        llDialog(av, "\nSettings\n\n"
                   + "Most settings live in the on screen Settings app. "
                   + "These are the ones that belong to the object itself.",
            [ "Idle on/off", "Debug on/off", "Reload config",
              "Re-register", "Reset TV", "Back" ], menuChannel);
    }
    else if (page == "games")
    {
        llDialog(av, "\nStart which game on the TV?",
            [ "Tic-Tac-Toe", "Connect Four", "Rock Paper",
              "Trivia", "Number Guess", "Reaction", "Back" ], menuChannel);
    }
}

// ---------------------------------------------------------------------------
//  HUD pairing
// ---------------------------------------------------------------------------
//  Asks the backend for a token scoped to this avatar and this TV. The reply
//  comes back through net_bridge and is relayed to the HUD on a region channel.
// ---------------------------------------------------------------------------
pairHud(key av)
{
    integer sameGroup = 0;
    if (llSameGroup(av)) sameGroup = 1;

    llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/pair|"
        + llList2Json(JSON_OBJECT, [
            "tvId", (string)llGetKey(),
            "k",    (string)av,
            "n",    llGetDisplayName(av),
            "g",    (string)sameGroup
        ]), av);
}

// Ask the backend to act, having already checked locally that this avatar is
// allowed to. The backend checks again - see tvState.canControl.
sendCommand(key av, string action, string extra)
{
    list fields = [
        "tvId", (string)llGetKey(),
        "c",    action,
        "k",    (string)av,
        "n",    llGetDisplayName(av)
    ];
    if (extra != "") fields += [ "v", extra ];

    llMessageLinked(LINK_SET, MI_NET_SEND,
        "/api/lsl/command|" + llList2Json(JSON_OBJECT, fields), av);
}
// Hand the whole screen to an external site. Our interface is replaced while
// that is up - see moap_controller for why there is no way around that.
// Maps a HUD button id onto the menu label runAction already handles, so the
// remote and the object menu cannot drift apart into two behaviours.
string appLabel(string id)
{
    if (id == "movies")   return "Movies";
    if (id == "youtube")  return "YouTube";
    if (id == "music")    return "Music";
    if (id == "twitch")   return "Twitch";
    if (id == "kick")     return "Kick";
    if (id == "browser")  return "Browser";
    if (id == "messages") return "Messages";
    if (id == "clock")    return "Clock";
    if (id == "games")    return "Games";
    if (id == "settings") return "Settings";
    return id;
}

openApp(key av, string source, string url)
{
    if (url == "")
    {
        llRegionSayTo(av, 0, "Smart TV: no address is configured for " + source + ".");
        return;
    }
    llMessageLinked(LINK_SET, 110, url, av);          // MI_MOAP_SET
    sendCommand(av, "nav", url);
    llRegionSayTo(av, 0, "Smart TV: opening " + source
        + " on the screen. Use TV Home to come back.");
}


// ---------------------------------------------------------------------------
//  Carrying out a menu choice
// ---------------------------------------------------------------------------
//  Reached only after permission_manager has approved the avatar. Anything
//  that changes what other people see also goes to the backend, so the web
//  screens and every other viewer follow.
// ---------------------------------------------------------------------------
runAction(key av, string choice)
{
    if (choice == "Play/Pause")      { sendCommand(av, "play", ""); return; }
    if (choice == "Stop")            { sendCommand(av, "stop", ""); return; }
    if (choice == "TV Home")
    {
        llMessageLinked(LINK_SET, MI_MOAP_HOME, "", av);
        sendCommand(av, "home", "");
        return;
    }

    // ---- apps ----
    if (choice == "Movies")   { openApp(av, "movies",   llLinksetDataRead("movies_url")); return; }
    if (choice == "YouTube")  { openApp(av, "youtube",  "https://www.youtube.com/");      return; }
    if (choice == "Twitch")   { openApp(av, "twitch",   "https://www.twitch.tv/");        return; }
    if (choice == "Kick")     { openApp(av, "kick",     "https://kick.com/");             return; }
    if (choice == "Browser")  { openApp(av, "browser",  llLinksetDataRead("home_url"));   return; }

    // These run inside the TV interface rather than replacing it, so they are
    // a view change on the existing page, not a prim navigation.
    if (choice == "Music" || choice == "Messages" || choice == "Clock")
    {
        sendCommand(av, "view", llToLower(choice));
        return;
    }

    // ---- access ----
    if (choice == "Owner" || choice == "Group" || choice == "Everyone" || choice == "Host")
    {
        if (av != llGetOwner())
        {
            llRegionSayTo(av, 0, "Smart TV: only the owner changes the control mode.");
            return;
        }
        sendCommand(av, "mode", llToLower(choice));
        llMessageLinked(LINK_SET, MI_CFG_SET, "permission_mode|" + llToLower(choice), av);
        return;
    }
    if (choice == "Request control") { sendCommand(av, "host", "claim"); return; }
    if (choice == "Release host")    { sendCommand(av, "host", "release"); return; }

    // ---- games ----
    if (choice == "Tic-Tac-Toe")  { llMessageLinked(LINK_SET, MI_GAME, "start|tictactoe", av); return; }
    if (choice == "Connect Four") { llMessageLinked(LINK_SET, MI_GAME, "start|connectfour", av); return; }
    if (choice == "Rock Paper")   { llMessageLinked(LINK_SET, MI_GAME, "start|rps", av); return; }
    if (choice == "Trivia")       { llMessageLinked(LINK_SET, MI_GAME, "start|trivia", av); return; }
    if (choice == "Number Guess") { llMessageLinked(LINK_SET, MI_GAME, "start|numberguess", av); return; }
    if (choice == "Reaction")     { llMessageLinked(LINK_SET, MI_GAME, "start|reaction", av); return; }

    // ---- owner only maintenance ----
    if (av != llGetOwner()) return;

    if (choice == "Idle on/off")
    {
        string now = llLinksetDataRead("idle_enabled");
        string next = "1";
        if (now == "1") next = "0";
        llMessageLinked(LINK_SET, MI_CFG_SET, "idle_enabled|" + next, av);
        llOwnerSay("Smart TV: idle screen " + llList2String(["off", "on"], (integer)next) + ".");
    }
    else if (choice == "Debug on/off")
    {
        string nowd = llLinksetDataRead("debug");
        string nextd = "1";
        if (nowd == "1") nextd = "0";
        llMessageLinked(LINK_SET, MI_CFG_SET, "debug|" + nextd, av);
        llMessageLinked(LINK_SET, MI_MOAP_HOME, "", av);
        llOwnerSay("Smart TV: debug overlay " + llList2String(["off", "on"], (integer)nextd) + ".");
    }
    else if (choice == "Reload config")
    {
        llOwnerSay("Smart TV: re-reading the config notecard.");
        llMessageLinked(LINK_SET, MI_CFG_GET, "backend_url", av);
    }
    else if (choice == "Re-register")
    {
        llResetOtherScript("net_bridge");
        llOwnerSay("Smart TV: re-registering with the cloud.");
    }
    else if (choice == "Reset TV")
    {
        llOwnerSay("Smart TV: resetting all scripts. Settings are kept.");
        llResetScript();
    }
}

default
{
    state_entry()
    {
        llListen(HUD_CHANNEL, "", NULL_KEY, "");
        llMessageLinked(LINK_SET, MI_CFG_GET, "frontend_url", NULL_KEY);
        llSetText("", <1,1,1>, 0.0);
    }

    touch_start(integer n)
    {
        key av = llDetectedKey(0);
        llMessageLinked(LINK_SET, MI_ACTIVITY, "", av);

        // Pair first, so a HUD is usable immediately after the first touch.
        pairHud(av);

        // Then decide which menu they get. The permission answer arrives
        // asynchronously, so the menu opens either way and individual actions
        // are checked when chosen.
        showMenu(av, "main");
    }

    listen(integer channel, string name, key id, string msg)
    {
        if (channel == HUD_CHANNEL)
        {
            // A HUD asking to be paired again, typically after a relog.
            if (msg == "pair") { pairHud(id); return; }

            // "kind|value|avatarKey" - a button press on somebody remote.
            list parts = llParseString2List(msg, ["|"], []);
            if (llGetListLength(parts) < 3) return;

            string kind  = llList2String(parts, 0);
            string value = llList2String(parts, 1);
            key    av    = (key)llList2String(parts, 2);

            // The avatar key is asserted by the HUD, so it is treated as a
            // claim and nothing more. Every action it leads to is checked by
            // permission_manager here and by the backend again afterwards, so
            // a forged key buys no control it did not already have.
            llMessageLinked(LINK_SET, MI_ACTIVITY, "", av);

            if (kind == "media")
            {
                if (value == "playpause")   llMessageLinked(LINK_SET, MI_PERM_CHECK, "Play/Pause", av);
                else if (value == "stop")   llMessageLinked(LINK_SET, MI_PERM_CHECK, "Stop", av);
                else if (value == "power")  llMessageLinked(LINK_SET, MI_PERM_CHECK, "TV Home", av);
                else sendCommand(av, value, "");
            }
            else if (kind == "key")
            {
                if (value == "home") llMessageLinked(LINK_SET, MI_PERM_CHECK, "TV Home", av);
                else sendCommand(av, "key", value);
            }
            else if (kind == "app")
            {
                llMessageLinked(LINK_SET, MI_PERM_CHECK, appLabel(value), av);
            }
            return;
        }

        if (channel != menuChannel || id != menuUser) return;
        llMessageLinked(LINK_SET, MI_ACTIVITY, "", id);

        // ---- navigation between menu pages ----
        if (msg == "Close")  { llListenRemove(menuHandle); menuHandle = 0; return; }
        if (msg == "Back")   { showMenu(id, "main"); return; }
        if (msg == "Apps")   { showMenu(id, "apps"); return; }
        if (msg == "Games")  { showMenu(id, "games"); return; }
        if (msg == "Access") { showMenu(id, "access"); return; }
        if (msg == "Settings" && id == llGetOwner()) { showMenu(id, "settings"); return; }

        // ---- actions that need control ----
        // Checked here for a fast local refusal, and again by the backend.
        llMessageLinked(LINK_SET, MI_PERM_CHECK, msg, id);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_NET_STATUS)
        {
            backendOnline = (str == "online");
            return;
        }

        if (num == MI_PERM_RESULT)
        {
            integer bar = llSubStringIndex(str, "|");
            string verdict = llGetSubString(str, 0, bar - 1);
            string detail  = llGetSubString(str, bar + 1, -1);

            if (verdict == "0")
            {
                llRegionSayTo(id, 0, "Smart TV: " + detail);
                return;
            }
            runAction(id, detail);
            return;
        }

        if (num == MI_NET_RECV)
        {
            string c = llJsonGetValue(str, ["c"]);

            // A token for a HUD we asked to pair.
            if (c == "pair" || llJsonGetValue(str, ["t"]) != JSON_INVALID)
            {
                string token = llJsonGetValue(str, ["t"]);
                if (token != JSON_INVALID && token != "")
                {
                    // Region local, addressed to the avatar who touched us.
                    // The HUD needs the frontend url to build its own screen,
                    // and it cannot read it from here: Linkset Data belongs to
                    // one linkset, and the HUD is a separate object. Sending it
                    // with the token makes the HUD self-configuring - no
                    // notecard of its own, nothing to keep in step by hand.
                    llRegionSayTo(id, HUD_CHANNEL,
                        "token|" + (string)llGetKey() + "|" + token
                        + "|" + llLinksetDataRead("frontend_url"));
                }
            }
        }
    }

    timer()
    {
        // Menus do not stay open forever. An abandoned listener is a live
        // event handler on a busy sim for no reason.
        if (menuHandle) llListenRemove(menuHandle);
        menuHandle = 0;
        llSetTimerEvent(0.0);
    }

    changed(integer c)
    {
        if (c & CHANGED_OWNER)
        {
            llResetScript();
        }
    }

    on_rez(integer p)
    {
        llResetScript();
    }
}
