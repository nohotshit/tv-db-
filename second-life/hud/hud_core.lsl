// ===========================================================================
//  Musical Impact Smart TV - hud_core.lsl   (goes in the REMOTE HUD)
// ---------------------------------------------------------------------------
//  The remote control. Attach it, touch a TV once to pair, and every button
//  works from anywhere in the region.
//
//  WHY A HUD EXISTS AT ALL, beyond convenience:
//    The TV screen shows the SAME web page to every avatar in range. It has no
//    way to tell who is looking at it or who clicked it - there is no per
//    viewer identity in a media face, and there never has been. So a screen
//    can never be personal.
//
//    A HUD is attached to exactly one avatar. Its media face url can therefore
//    carry that avatar key and a signed token, which makes it the only surface
//    in the whole system that can hold personal favorites, act as a named
//    person, or claim host. That is not a design preference, it is the shape
//    the platform forces.
//
//  Two ways to drive the TV, and both are here on purpose:
//    * the HUD media face, a full touch remote - needs the frontend reachable
//    * these prim buttons and the dialog menu - work with no web at all
// ===========================================================================

integer HUD_CHANNEL = -70701;       // shared with tv_core.lsl
integer MI_HUD_TOKEN = 300;
integer MI_HUD_TV    = 301;

key     pairedTV = NULL_KEY;
string  token = "";
string  frontendURL = "";
integer menuChannel;
integer menuHandle;

// Buttons are identified by the name of the touched prim, so the HUD can be
// re-linked and re-skinned without touching this script.
list MEDIA_BUTTONS = [ "power", "playpause", "stop", "prev", "next",
                       "volup", "voldown", "mute" ];
list NAV_BUTTONS   = [ "up", "down", "left", "right", "select", "back", "home" ];
list APP_BUTTONS   = [ "movies", "youtube", "music", "twitch", "kick",
                       "browser", "messages", "games", "settings", "clock" ];

// Everything the HUD sends goes to the TV object on a region channel, and the
// TV relays it to the backend. The HUD does not talk to the backend directly:
// that would double the HTTP traffic against the same per-owner throttle for
// no benefit, and the TV already holds the signed device identity.
sendToTV(string kind, string value)
{
    if (pairedTV == NULL_KEY)
    {
        llOwnerSay("Remote: not paired yet. Touch the TV once while wearing this.");
        return;
    }
    llRegionSayTo(pairedTV, HUD_CHANNEL, kind + "|" + value + "|" + (string)llGetOwner());
}

// The HUD media face, carrying this avatar identity. This is what makes the
// on-screen remote personal.
refreshHudScreen()
{
    if (frontendURL == "" || pairedTV == NULL_KEY) return;

    string url = frontendURL + "hud.html"
        + "?tv=" + llEscapeURL((string)pairedTV)
        + "&surface=hud"
        + "&u=" + llEscapeURL((string)llGetOwner())
        + "&n=" + llEscapeURL(llGetDisplayName(llGetOwner()));

    if (token != "") url += "&t=" + llEscapeURL(token);

    llSetLinkMedia(LINK_THIS, 0, [
        PRIM_MEDIA_CURRENT_URL, url,
        PRIM_MEDIA_HOME_URL, url,
        PRIM_MEDIA_AUTO_PLAY, TRUE,
        PRIM_MEDIA_AUTO_SCALE, TRUE,
        PRIM_MEDIA_FIRST_CLICK_INTERACT, FALSE,
        PRIM_MEDIA_WIDTH_PIXELS, 512,
        PRIM_MEDIA_HEIGHT_PIXELS, 1024,
        PRIM_MEDIA_CONTROLS, PRIM_MEDIA_CONTROLS_MINI,
        // A HUD is worn by one person, so only that person needs to touch it.
        PRIM_MEDIA_PERMS_INTERACT, PRIM_MEDIA_PERM_OWNER,
        PRIM_MEDIA_PERMS_CONTROL, PRIM_MEDIA_PERM_OWNER
    ]);
}

showMenu()
{
    if (menuHandle) llListenRemove(menuHandle);
    menuChannel = -1 - (integer)llFrand(90000000.0);
    menuHandle = llListen(menuChannel, "", llGetOwner(), "");
    llSetTimerEvent(60.0);

    string status = "Not paired";
    if (pairedTV != NULL_KEY) status = "Paired";
    if (token != "") status += ", linked";

    llDialog(llGetOwner(), "\nMusical Impact Remote\n" + status
               + "\n\nThese work even with no web connection.",
        [ "Play/Pause", "Stop", "Home",
          "Movies", "YouTube", "Music",
          "Twitch", "Kick", "Browser",
          "Re-pair", "Close" ], menuChannel);
}

default
{
    state_entry()
    {
        llListen(HUD_CHANNEL, "", NULL_KEY, "");
        // Remember the last TV so the remote still works after a relog without
        // walking back to the screen to touch it again.
        pairedTV = (key)llLinksetDataRead("paired_tv");
        frontendURL = llLinksetDataRead("frontend_url");
        if (pairedTV != NULL_KEY) refreshHudScreen();
    }

    attach(key av)
    {
        if (av != NULL_KEY && pairedTV != NULL_KEY)
        {
            // Ask for a fresh token: the old one may well have expired.
            llRegionSayTo(pairedTV, HUD_CHANNEL, "pair");
        }
    }

    touch_start(integer n)
    {
        if (llDetectedKey(0) != llGetOwner()) return;

        string btn = llToLower(llGetLinkName(llDetectedLinkNumber(0)));

        if (llListFindList(MEDIA_BUTTONS, [btn]) != -1) { sendToTV("media", btn); return; }
        if (llListFindList(NAV_BUTTONS,   [btn]) != -1) { sendToTV("key",   btn); return; }
        if (llListFindList(APP_BUTTONS,   [btn]) != -1) { sendToTV("app",   btn); return; }

        if (btn == "menu" || btn == "root") { showMenu(); return; }

        // Any other prim opens the menu, so a HUD that has not been renamed
        // is still usable rather than inert.
        showMenu();
    }

    listen(integer channel, string name, key id, string msg)
    {
        if (channel == HUD_CHANNEL)
        {
            // "token|<tvKey>|<token>" from the TV we just touched.
            if (llGetSubString(msg, 0, 5) != "token|") return;

            list parts = llParseString2List(msg, ["|"], []);
            pairedTV = (key)llList2String(parts, 1);
            token    = llList2String(parts, 2);

            llLinksetDataWrite("paired_tv", (string)pairedTV);
            refreshHudScreen();
            llOwnerSay("Remote: paired with this TV.");
            return;
        }

        if (channel != menuChannel) return;
        llListenRemove(menuHandle);
        menuHandle = 0;
        llSetTimerEvent(0.0);

        if (msg == "Close") return;
        if (msg == "Re-pair")
        {
            llOwnerSay("Remote: touch the TV to pair.");
            return;
        }
        if (msg == "Play/Pause") { sendToTV("media", "playpause"); return; }
        if (msg == "Stop")       { sendToTV("media", "stop"); return; }
        if (msg == "Home")       { sendToTV("key", "home"); return; }

        sendToTV("app", llToLower(msg));
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_HUD_TOKEN) { token = str; refreshHudScreen(); }
        else if (num == MI_HUD_TV) { pairedTV = (key)str; refreshHudScreen(); }
    }

    timer()
    {
        if (menuHandle) llListenRemove(menuHandle);
        menuHandle = 0;
        llSetTimerEvent(0.0);
    }

    changed(integer c)
    {
        if (c & CHANGED_OWNER) llResetScript();
    }
}
