// ===========================================================================
//  Musical Impact Smart TV - net_bridge.lsl
// ---------------------------------------------------------------------------
//  The ONLY script in the linkset that performs HTTP. Everything else asks it
//  for network access over link messages.
//
//  Why one script owns the network:
//    llHTTPRequest is throttled at roughly 25 requests per 20 seconds per
//    owner per region, and that budget is SHARED across every script that
//    owner is running there. Ten scripts each making their own calls would
//    race for it and drop each other requests. One gatekeeper spends it
//    deliberately, and queues rather than discards when it runs short.
//
//  Two directions, and they are not symmetrical:
//    out : llHTTPRequest to the Render backend, signed.
//    in  : llRequestSecureURL gives us an https endpoint the backend can POST
//          to. That url is EPHEMERAL - it is lost on script reset, on rez, and
//          whenever the region restarts - so we re-register on all three, and
//          the backend treats a dead url as routine rather than an error.
//
//  There is no WebSocket here because LSL has no WebSocket client. Push plus a
//  slow poll fallback is the closest thing that exists.
// ===========================================================================

integer MI_NET_SEND    = 100;
integer MI_NET_RECV    = 101;
integer MI_NET_STATUS  = 102;
integer MI_CFG_GET     = 120;
integer MI_CFG_VALUE   = 121;

string  BACKEND;              // https://your-backend.onrender.com
string  SECRET;               // shared secret, from the config notecard
string  DEVICE_SECRET;        // per-device secret issued at registration

key     urlRequest;           // llRequestSecureURL handle
string  myURL;                // our HTTP-in endpoint

list    pending;              // [requestId, endpoint, requestId, endpoint, ...]
list    queue;                // ["endpoint|body", ...] waiting for throttle room

integer POLL_SECONDS  = 30;   // fallback poll; deliberately slow
integer sentThisWindow;       // simple local throttle accounting
integer windowStart;
integer online = FALSE;

// ---------------------------------------------------------------------------
//  Request signing
// ---------------------------------------------------------------------------
//  sig = sha256( secret + ":" + sha256( secret + ":" + ts + ":" + body ) )
//
//  This is NOT HMAC-SHA256, and that is deliberate rather than a shortcut.
//  HMAC requires XORing the key byte-wise with the ipad/opad constants and
//  concatenating the inner digest as RAW BYTES. LSL has llSHA256String, which
//  hashes the UTF-8 bytes of a string: there is no byte array type, no XOR
//  across a string, and any digest byte above 0x7F would be re-encoded as two
//  UTF-8 bytes and change the result. HMAC simply cannot be computed here.
//
//  The two-pass form above is what LSL can produce, and it avoids the length
//  extension weakness a plain sha256(secret + message) would carry.
// ---------------------------------------------------------------------------
string sign(string ts, string body)
{
    // Not named "key": that is a TYPE in LSL, and using it as a variable name
    // is a syntax error rather than merely poor style.
    string signingKey = DEVICE_SECRET;
    if (signingKey == "") signingKey = SECRET;
    string inner = llSHA256String(signingKey + ":" + ts + ":" + body);
    return llSHA256String(signingKey + ":" + inner);
}

// LSL integers are 32 bit, so llGetUnixTime() * 1000 overflows. The bridge
// protocol speaks UNIX SECONDS for exactly this reason.
string stamp()
{
    return (string)llGetUnixTime();
}

// ---------------------------------------------------------------------------
//  Outbound
// ---------------------------------------------------------------------------
integer throttleRoom()
{
    integer now = llGetUnixTime();
    if (now - windowStart >= 20)
    {
        windowStart = now;
        sentThisWindow = 0;
    }
    // Stay under the documented 25 per 20 seconds, leaving headroom for any
    // other script the owner happens to be running on this region.
    return (sentThisWindow < 18);
}

send(string endpoint, string body)
{
    if (BACKEND == "")
    {
        return;             // not configured yet; local features still work
    }

    if (!throttleRoom())
    {
        queue += [endpoint + "|" + body];
        if (llGetListLength(queue) > 12)
        {
            queue = llDeleteSubList(queue, 0, 0);   // drop the oldest
        }
        return;
    }

    sentThisWindow++;
    string ts = stamp();

    key id = llHTTPRequest(BACKEND + endpoint,
        [ HTTP_METHOD, "POST",
          HTTP_MIMETYPE, "application/json",
          HTTP_VERIFY_CERT, TRUE,
          // Default response cap is 2048 bytes; it can be raised to 16384.
          HTTP_BODY_MAXLENGTH, 16384,
          HTTP_CUSTOM_HEADER, "X-MI-Timestamp", ts,
          HTTP_CUSTOM_HEADER, "X-MI-Signature", sign(ts, body) ],
        body);

    pending += [ (string)id, endpoint ];
    if (llGetListLength(pending) > 24)
    {
        pending = llDeleteSubList(pending, 0, 1);
    }
}

drainQueue()
{
    while (llGetListLength(queue) > 0 && throttleRoom())
    {
        string item = llList2String(queue, 0);
        queue = llDeleteSubList(queue, 0, 0);
        integer bar = llSubStringIndex(item, "|");
        send(llGetSubString(item, 0, bar - 1), llGetSubString(item, bar + 1, -1));
    }
}

// ---------------------------------------------------------------------------
//  Registration
// ---------------------------------------------------------------------------
//  Called on script start, on rez, and on region change. Each of those events
//  invalidates the HTTP-in url, so re-registering is routine housekeeping and
//  not an error path.
// ---------------------------------------------------------------------------
registerWithBackend()
{
    if (BACKEND == "") return;

    string body = llList2Json(JSON_OBJECT, [
        "tvId",  (string)llGetKey(),
        "name",  llGetObjectName(),
        "url",   myURL,
        "mode",  "owner",
        "group", ""
    ]);
    send("/api/lsl/register", body);
}

requestURL()
{
    llReleaseURL(myURL);
    myURL = "";
    // Secure, not plain: the backend is https, and an http endpoint would be
    // mixed content the moment anything in a browser touched it.
    urlRequest = llRequestSecureURL();
}

default
{
    state_entry()
    {
        windowStart = llGetUnixTime();
        llMessageLinked(LINK_SET, MI_CFG_GET, "backend_url", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "shared_secret", NULL_KEY);
        llMessageLinked(LINK_SET, MI_CFG_GET, "device_secret", NULL_KEY);
        requestURL();
        llSetTimerEvent(POLL_SECONDS);
    }

    on_rez(integer p)
    {
        // The url did not survive being rezzed. Nothing else needs resetting.
        requestURL();
    }

    changed(integer c)
    {
        if (c & CHANGED_REGION || c & CHANGED_REGION_START)
        {
            requestURL();
        }
        if (c & CHANGED_OWNER)
        {
            // A new owner means a new device identity. Drop the old secret so
            // the next registration pairs cleanly.
            DEVICE_SECRET = "";
            llMessageLinked(LINK_SET, MI_CFG_VALUE, "device_secret|", NULL_KEY);
            requestURL();
        }
    }

    http_request(key id, string method, string body)
    {
        if (method == URL_REQUEST_GRANTED)
        {
            myURL = body;
            registerWithBackend();
            return;
        }

        if (method == URL_REQUEST_DENIED)
        {
            // The region has run out of its url allocation. Not fatal: the
            // poll fallback keeps the TV working, just less promptly.
            myURL = "";
            llOwnerSay("Smart TV: this region would not grant an HTTP-in url. "
                     + "The TV will fall back to polling every "
                     + (string)POLL_SECONDS + " seconds.");
            return;
        }

        if (method == "POST")
        {
            // A push from the backend. Verify it before acting on it: anyone
            // who learns this url could otherwise drive the TV.
            string ts  = llGetHTTPHeader(id, "x-mi-timestamp");
            string sig = llGetHTTPHeader(id, "x-mi-signature");

            if (sig != sign(ts, body))
            {
                llHTTPResponse(id, 403, "{\"e\":\"sig\"}");
                return;
            }

            integer age = llGetUnixTime() - (integer)ts;
            if (age < 0) age = -age;
            if (age > 300)
            {
                llHTTPResponse(id, 403, "{\"e\":\"stale\"}");
                return;
            }

            // llHTTPResponse bodies are capped at 2048 bytes - a hard limit,
            // unlike the raisable cap on responses we RECEIVE. Keep it short.
            llHTTPResponse(id, 200, "{\"ok\":1}");
            llMessageLinked(LINK_SET, MI_NET_RECV, body, NULL_KEY);
            return;
        }

        llHTTPResponse(id, 405, "{\"e\":\"method\"}");
    }

    http_response(key id, integer status, list metadata, string body)
    {
        integer idx = llListFindList(pending, [ (string)id ]);
        if (idx != -1)
        {
            pending = llDeleteSubList(pending, idx, idx + 1);
        }

        if (status != 200)
        {
            if (online)
            {
                online = FALSE;
                llMessageLinked(LINK_SET, MI_NET_STATUS, "offline", NULL_KEY);
            }
            return;
        }

        if (!online)
        {
            online = TRUE;
            llMessageLinked(LINK_SET, MI_NET_STATUS, "online", NULL_KEY);
        }

        // Registration hands back the per-device secret. Store it so every
        // later request is signed with a key unique to this object.
        string sec = llJsonGetValue(body, ["sec"]);
        if (sec != JSON_INVALID && sec != "")
        {
            DEVICE_SECRET = sec;
            llMessageLinked(LINK_SET, MI_CFG_VALUE, "device_secret|" + sec, NULL_KEY);
        }

        // A poll response carries anything that could not be pushed while the
        // object was unreachable.
        string queued = llJsonGetValue(body, ["q"]);
        if (queued != JSON_INVALID && queued != "[]")
        {
            integer i = 0;
            string item = llJsonGetValue(queued, [ (string)i ]);
            while (item != JSON_INVALID && i < 5)
            {
                llMessageLinked(LINK_SET, MI_NET_RECV, item, NULL_KEY);
                i++;
                item = llJsonGetValue(queued, [ (string)i ]);
            }
        }

        // Current TV state, forwarded intact so sync_manager sees the real
        // values rather than just a nudge that something changed.
        string st = llJsonGetValue(body, ["st"]);
        if (st != JSON_INVALID && st != "")
        {
            llMessageLinked(LINK_SET, MI_NET_RECV,
                llJsonSetValue(st, ["c"], "state"), NULL_KEY);
        }
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_NET_SEND)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar > 0)
            {
                send(llGetSubString(str, 0, bar - 1),
                     llGetSubString(str, bar + 1, -1));
            }
            return;
        }

        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            string k = llGetSubString(str, 0, bar - 1);
            string v = llGetSubString(str, bar + 1, -1);

            if (k == "backend_url")
            {
                BACKEND = v;
                if (BACKEND != "" && myURL != "") registerWithBackend();
            }
            else if (k == "shared_secret") SECRET = v;
            else if (k == "device_secret") DEVICE_SECRET = v;
        }
    }

    timer()
    {
        drainQueue();

        // Poll only when there is no live push endpoint, or occasionally as a
        // heartbeat so the backend knows the url is still good. Polling hard
        // would burn the request budget that playback commands need.
        if (BACKEND == "") return;

        if (myURL == "")
        {
            requestURL();
            send("/api/lsl/poll", llList2Json(JSON_OBJECT, ["tvId", (string)llGetKey()]));
        }
        else if (llFrand(1.0) < 0.25)
        {
            send("/api/lsl/poll", llList2Json(JSON_OBJECT, ["tvId", (string)llGetKey()]));
        }
    }
}
