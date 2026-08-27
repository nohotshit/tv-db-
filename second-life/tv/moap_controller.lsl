// ===========================================================================
//  Musical Impact Smart TV - moap_controller.lsl
// ---------------------------------------------------------------------------
//  Owns the media face. This is the only script that calls llSetLinkMedia.
//
//  WHAT MOAP CAN AND CANNOT DO - the honest list, because the rest of the
//  system is designed around it:
//
//   * A script can SET the url on a face. That is the entire navigation API.
//     There is no back, no forward, no reload, no "what is currently loaded",
//     and no way to read anything out of the page. Our Back and Forward are a
//     url stack we keep ourselves and re-set; Refresh is re-setting the same
//     url, which is what a reload is from out here.
//
//   * The texture is capped at 1024 x 1024 pixels. The interface is built for
//     1024 x 576, which is 16:9 and what a TV prim actually looks like.
//
//   * Every avatar viewer loads the url independently. Nothing is shared
//     between them automatically - that is exactly why the frontend talks to
//     the backend over a WebSocket, and why playback synchronisation has to be
//     built rather than assumed.
//
//   * There is no volume parameter. Media volume is each viewer own setting.
//     The HUD volume buttons only affect audio the TV app itself plays.
//
//   * A viewer only loads media if they have media enabled and are close
//     enough. Auto play helps but guarantees nothing.
// ===========================================================================

integer MI_MOAP_SET   = 110;
integer MI_MOAP_HOME  = 111;
integer MI_MOAP_IDLE  = 112;
integer MI_CFG_GET    = 120;
integer MI_CFG_VALUE  = 121;
integer MI_NET_RECV   = 101;

integer FACE = 0;                 // overridden by the media_face setting

string  frontendURL;              // the Smart TV interface itself
string  currentURL;
integer whitelistOn = FALSE;

// ---------------------------------------------------------------------------
//  Setting the face
// ---------------------------------------------------------------------------
setMedia(string url)
{
    if (url == "") return;
    currentURL = url;

    llSetLinkMedia(LINK_THIS, FACE, [
        PRIM_MEDIA_CURRENT_URL,        url,
        PRIM_MEDIA_HOME_URL,           frontendURL,
        PRIM_MEDIA_AUTO_PLAY,          TRUE,
        PRIM_MEDIA_AUTO_SCALE,         TRUE,
        PRIM_MEDIA_AUTO_ZOOM,          FALSE,
        PRIM_MEDIA_FIRST_CLICK_INTERACT, TRUE,
        // 1024 is the maximum the viewer will render for a media face.
        PRIM_MEDIA_WIDTH_PIXELS,       1024,
        PRIM_MEDIA_HEIGHT_PIXELS,      576,
        PRIM_MEDIA_CONTROLS,           PRIM_MEDIA_CONTROLS_MINI,
        // Anyone may click and interact with the screen. Whether their click
        // actually changes anything is decided by the permission mode, on the
        // server - not here.
        PRIM_MEDIA_PERMS_INTERACT,     PRIM_MEDIA_PERM_ANYONE,
        // Only the owner gets the viewer own navigation chrome.
        PRIM_MEDIA_PERMS_CONTROL,      PRIM_MEDIA_PERM_OWNER
    ]);
}

// The whitelist is a genuine second line of defence: even if something got a
// bad url past the backend, the viewer refuses to load a domain that is not
// listed. It only filters navigation the PAGE attempts, not what a script
// sets, so it is a safety net rather than the primary control.
applyWhitelist(string csv)
{
    if (csv == "")
    {
        whitelistOn = FALSE;
        llSetLinkMedia(LINK_THIS, FACE, [ PRIM_MEDIA_WHITELIST_ENABLE, FALSE ]);
        return;
    }
    whitelistOn = TRUE;
    llSetLinkMedia(LINK_THIS, FACE, [
        PRIM_MEDIA_WHITELIST_ENABLE, TRUE,
        PRIM_MEDIA_WHITELIST, csv
    ]);
}

// The Smart TV interface, with everything it needs to identify itself.
// The frontend reads these from the query string - see js/core/config.js.
goHome()
{
    if (frontendURL == "")
    {
        llOwnerSay("Smart TV: frontend_url is not set. "
                 + "Add it to the TV Config notecard.");
        return;
    }

    string url = frontendURL
        + "?tv="    + llEscapeURL((string)llGetKey())
        + "&surface=tv";

    string logo = llLinksetDataRead("logo_uuid");
    if (logo != "") url += "&logo=" + llEscapeURL(logo);

    string movies = llLinksetDataRead("movies_url");
    if (movies != "") url += "&movies=" + llEscapeURL(movies);

    string home = llLinksetDataRead("home_url");
    if (home != "") url += "&home=" + llEscapeURL(home);

    if (llLinksetDataRead("debug") == "1") url += "&debug=1";

    setMedia(url);
}

default
{
    state_entry()
    {
        llMessageLinked(LINK_SET, MI_CFG_GET, "frontend_url", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "media_face", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "media_whitelist", NULL_KEY);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_MOAP_SET)
        {
            setMedia(str);
            return;
        }

        if (num == MI_MOAP_HOME)
        {
            goHome();
            return;
        }

        if (num == MI_MOAP_IDLE)
        {
            // The idle screen is the same web app on its idle route, so the
            // logo and clock come from one place rather than being duplicated
            // as an in-world texture. If the frontend is unreachable the idle
            // manager falls back to a texture instead.
            if (frontendURL == "") return;
            setMedia(frontendURL
                + "?tv=" + llEscapeURL((string)llGetKey())
                + "&surface=tv&view=idle");
            return;
        }

        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            string k = llGetSubString(str, 0, bar - 1);
            string v = llGetSubString(str, bar + 1, -1);

            if (k == "frontend_url")
            {
                frontendURL = v;
                if (frontendURL != "" && currentURL == "") goHome();
            }
            else if (k == "media_face")
            {
                integer newFace = (integer)v;
                if (newFace != FACE)
                {
                    // The face setting can arrive AFTER media was already
                    // placed, because the notecard loads asynchronously. Clear
                    // the old face first, or the interface stays visible on
                    // the wrong side of the prim while the intended one is
                    // blank - which looks exactly like a TV that never worked.
                    if (currentURL != "") llClearLinkMedia(LINK_THIS, FACE);
                    FACE = newFace;
                    if (currentURL != "") setMedia(currentURL);
                }
            }
            else if (k == "media_whitelist")
            {
                applyWhitelist(v);
            }
            return;
        }

        // A navigation command that arrived from the backend.
        if (num == MI_NET_RECV)
        {
            string c = llJsonGetValue(str, ["c"]);

            if (c == "nav")
            {
                string url = llJsonGetValue(str, ["url"]);
                if (url != JSON_INVALID && url != "") setMedia(url);
            }
            else if (c == "home")
            {
                goHome();
            }
        }
    }

    on_rez(integer p)
    {
        // Re-assert the face: a rezzed copy starts with whatever media it was
        // saved with, which may be a stale url from another session.
        if (frontendURL != "") goHome();
    }
}
