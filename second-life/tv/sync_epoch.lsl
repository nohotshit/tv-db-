// ===========================================================================
//  Musical Impact Smart TV - sync_epoch.lsl
// ---------------------------------------------------------------------------
//  Playback synchronisation, held as an ANCHOR rather than a position.
//
//  THE IDEA
//    The shared state is four values:
//
//      video       what is playing
//      startedAt   the Unix second at which position 0 occurred
//      state       playing | paused | stopped
//      pausedAt    position, while paused
//
//    Nobody is ever told where to be. Each viewer computes it:
//
//      position = llGetUnixTime() - startedAt      (playing)
//      position = pausedAt                         (paused)
//
//    A viewer arriving 300 seconds after the film began reads the same
//    unchanged anchor everyone else has and derives 300 without a single
//    message being sent to them.
//
//  WHY THIS IS CHEAP
//    The anchor only changes when somebody presses a button. Between presses
//    this script does NOTHING: no timer, no listener, no chat, no polling, no
//    per-viewer bookkeeping. Twenty people watching a two hour film cost the
//    same as one. That is the whole reason to prefer an anchor over
//    broadcasting a position several times a second.
//
//  WHAT THE VIEWERS SEE
//    The anchor travels in the MOAP url. A page load therefore carries the
//    sync state with it, so a late joiner is correct on its first frame - no
//    request, no round trip, no visible seek from zero.
// ===========================================================================

integer MI_MOAP_SET  = 110;
integer MI_SYNC_CMD  = 160;
integer MI_SYNC_STATE= 161;
integer MI_CFG_GET   = 120;
integer MI_CFG_VALUE = 121;

string  frontendURL;

// ---- the anchor -----------------------------------------------------------
string  video    = "";
integer startedAt = 0;
string  playState = "stopped";
integer pausedAt = 0;
integer duration = 0;          // seconds, 0 = unknown or live
integer looping  = FALSE;

// Where the video should be right now, by the same arithmetic every viewer
// runs. Kept here so the object can describe itself in hover text and menus
// without asking anyone.
integer expectedPosition()
{
    if (playState == "stopped") return 0;
    if (playState == "paused")  return pausedAt;

    integer position = llGetUnixTime() - startedAt;
    if (position < 0) position = 0;

    if (duration > 0)
    {
        if (looping) position = position % duration;
        else if (position > duration) position = duration;
    }
    return position;
}

// The anchor survives a script reset, a rez, and a region restart. Without
// this, resetting the TV would silently restart the film for everybody.
persist()
{
    llLinksetDataWrite("sync_video", video);
    llLinksetDataWrite("sync_start", (string)startedAt);
    llLinksetDataWrite("sync_state", playState);
    llLinksetDataWrite("sync_paused", (string)pausedAt);
}

restore()
{
    video     = llLinksetDataRead("sync_video");
    startedAt = (integer)llLinksetDataRead("sync_start");
    playState = llLinksetDataRead("sync_state");
    pausedAt  = (integer)llLinksetDataRead("sync_paused");
    if (playState == "") playState = "stopped";
}

// ---------------------------------------------------------------------------
//  Publishing the anchor
// ---------------------------------------------------------------------------
//  Setting the media url is the ONLY thing that has to happen when the anchor
//  changes, and it reaches every viewer at once. There is no fan-out loop and
//  no list of who is watching, because none is needed.
// ---------------------------------------------------------------------------
publish()
{
    persist();
    llMessageLinked(LINK_SET, MI_SYNC_STATE, llList2Json(JSON_OBJECT, [
        "v",  video,
        "t0", (string)startedAt,
        "st", playState,
        "p",  (string)pausedAt,
        "pos",(string)expectedPosition()
    ]), NULL_KEY);

    if (frontendURL == "") return;

    string url = frontendURL
        + "?tv="  + llEscapeURL((string)llGetKey())
        + "&surface=tv"
        + "&v="   + llEscapeURL(video)
        + "&t0="  + (string)startedAt
        + "&st="  + playState
        + "&p="   + (string)pausedAt;

    if (duration > 0) url += "&d=" + (string)duration;
    if (looping)      url += "&loop=1";

    llMessageLinked(LINK_SET, MI_MOAP_SET, url, NULL_KEY);
}

// ---------------------------------------------------------------------------
//  Operations
// ---------------------------------------------------------------------------
//  Each one REBASES the anchor. None of them ever says "seek to zero", which
//  is what stops a new arrival from restarting the film for the room.
// ---------------------------------------------------------------------------

// Play from wherever we already were. Resuming a paused video anchors it so
// that its paused position lands on this instant.
doPlay()
{
    integer from = expectedPosition();
    startedAt = llGetUnixTime() - from;
    playState = "playing";
    publish();
}

doPause()
{
    pausedAt = expectedPosition();
    playState = "paused";
    publish();
}

doStop()
{
    playState = "stopped";
    pausedAt = 0;
    startedAt = 0;
    publish();
}

// A new video always begins at 0, and this is the only path that does.
doSelect(string newVideo, integer newDuration)
{
    video = newVideo;
    duration = newDuration;
    pausedAt = 0;
    startedAt = llGetUnixTime();
    playState = "playing";
    publish();
}

doSeek(integer position)
{
    if (position < 0) position = 0;
    if (playState == "paused") pausedAt = position;
    else startedAt = llGetUnixTime() - position;
    publish();
}

default
{
    state_entry()
    {
        restore();
        llMessageLinked(LINK_SET, MI_CFG_GET, "frontend_url", NULL_KEY);
        // No timer. The anchor does not need maintaining - that is the point.
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            if (llGetSubString(str, 0, bar - 1) == "frontend_url")
            {
                frontendURL = llGetSubString(str, bar + 1, -1);
                if (frontendURL != "") publish();
            }
            return;
        }

        if (num != MI_SYNC_CMD) return;

        // "action" or "action|value"
        integer bar = llSubStringIndex(str, "|");
        string action = str;
        string value = "";
        if (bar > 0)
        {
            action = llGetSubString(str, 0, bar - 1);
            value  = llGetSubString(str, bar + 1, -1);
        }

        if (action == "play")       doPlay();
        else if (action == "pause") doPause();
        else if (action == "stop")  doStop();
        else if (action == "seek")  doSeek((integer)value);
        else if (action == "select")
        {
            // "select|<video>" or "select|<video>;<durationSeconds>"
            integer semi = llSubStringIndex(value, ";");
            if (semi > 0)
            {
                doSelect(llGetSubString(value, 0, semi - 1),
                         (integer)llGetSubString(value, semi + 1, -1));
            }
            else
            {
                doSelect(value, 0);
            }
        }
        else if (action == "toggle")
        {
            if (playState == "playing") doPause();
            else doPlay();
        }
        else if (action == "republish") publish();
    }

    on_rez(integer p)
    {
        // Re-assert the anchor onto the face. The prim may have been rezzed
        // showing a stale url from whenever it was taken to inventory.
        restore();
        if (frontendURL != "") publish();
    }

    changed(integer c)
    {
        if (c & CHANGED_REGION || c & CHANGED_REGION_START)
        {
            // Region time is Unix time, so the anchor is still valid. Just put
            // it back on the face for anyone who reloaded during the restart.
            if (frontendURL != "") publish();
        }
    }
}
