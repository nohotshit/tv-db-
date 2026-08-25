// ===========================================================================
//  Musical Impact Smart TV - messaging_manager.lsl
// ---------------------------------------------------------------------------
//  Delivers messages between people using the TV.
//
//  WHAT THIS DOES
//    Takes a message typed into the TV interface and says it in world with
//    llRegionSayTo, or sends it as an instant message FROM THE OBJECT if the
//    recipient has walked away. Takes text typed at the object and passes it
//    up to the web interface.
//
//  WHAT THIS DOES NOT DO, AND CANNOT
//    It has no access to anyone private instant messages, group chat, friend
//    list, or account. No script can read those - there is no LSL function
//    that exposes them, by design - and nothing here attempts to work around
//    that. Every message handled by this script was typed INTO this TV by
//    someone using it.
//
//  llInstantMessage carries a two second script delay per call, so instant
//  messages are used only as the fallback for someone who is no longer in the
//  region. Local delivery uses llRegionSayTo, which has no such delay.
// ===========================================================================

integer MI_NET_SEND = 100;
integer MI_NET_RECV = 101;
integer MI_MSG_OUT  = 150;
integer MI_MSG_IN   = 151;
integer MI_CFG_GET  = 120;
integer MI_CFG_VALUE= 121;
integer MI_ACTIVITY = 170;

integer CHAT_CHANNEL = 0;           // ordinary local chat
integer TEXT_CHANNEL;               // private channel for llTextBox replies
integer textHandle;
key     textUser;
integer enabled = TRUE;

// True when the avatar is still in this region and can hear local chat.
integer inRegion(key av)
{
    return (llGetAgentSize(av) != ZERO_VECTOR);
}

deliver(key to, string fromName, string text)
{
    if (!enabled) return;

    string line = "[Smart TV] " + fromName + ": " + text;

    if (to == NULL_KEY)
    {
        // Addressed to the room. Said by the object, in local chat, so it is
        // visible to exactly the people who are standing here.
        llSay(CHAT_CHANNEL, line);
        return;
    }

    if (inRegion(to))
    {
        llRegionSayTo(to, CHAT_CHANNEL, line);
    }
    else
    {
        // Two second delay, which is why this is the fallback and not default.
        llInstantMessage(to, line);
    }
}

default
{
    state_entry()
    {
        TEXT_CHANNEL = -1 - (integer)llFrand(80000000.0);
        llMessageLinked(LINK_SET, MI_CFG_GET, "messaging", NULL_KEY);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar > 0 && llGetSubString(str, 0, bar - 1) == "messaging")
            {
                enabled = (llGetSubString(str, bar + 1, -1) != "0");
            }
            return;
        }

        // "target|text" - target may be empty for the whole room.
        if (num == MI_MSG_OUT)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 0) return;
            string target = llGetSubString(str, 0, bar - 1);
            string text   = llGetSubString(str, bar + 1, -1);
            deliver((key)target, llGetDisplayName(id), text);
            return;
        }

        // A message pushed down from the backend, typed on a web surface.
        if (num == MI_NET_RECV)
        {
            if (llJsonGetValue(str, ["c"]) != "say") return;
            if (!enabled) return;

            string to   = llJsonGetValue(str, ["to"]);
            string from = llJsonGetValue(str, ["from"]);
            string txt  = llJsonGetValue(str, ["txt"]);
            if (txt == JSON_INVALID || txt == "") return;
            if (to == JSON_INVALID) to = "";

            deliver((key)to, from, txt);
        }
    }

    touch_start(integer n)
    {
        // A long touch opens a text box so someone with no HUD can still say
        // something to the room through the TV.
        key av = llDetectedKey(0);
        if (!enabled) return;

        textUser = av;
        if (textHandle) llListenRemove(textHandle);
        textHandle = llListen(TEXT_CHANNEL, "", av, "");
        llSetTimerEvent(120.0);

        llTextBox(av, "\nSay something to everyone at this TV.\n\n"
                    + "This is a message board for people here. It has nothing "
                    + "to do with your instant messages, which no script can read.",
                  TEXT_CHANNEL);
    }

    listen(integer channel, string name, key id, string msg)
    {
        if (channel != TEXT_CHANNEL || id != textUser) return;
        if (msg == "") return;

        llMessageLinked(LINK_SET, MI_ACTIVITY, "", id);
        deliver(NULL_KEY, llGetDisplayName(id), msg);

        // Pass it to the web surfaces as well, so it appears in the Messages
        // section rather than only in local chat.
        llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/message|"
            + llList2Json(JSON_OBJECT, [
                "tvId", (string)llGetKey(),
                "k",    (string)id,
                "n",    llGetDisplayName(id),
                "txt",  llGetSubString(msg, 0, 399)
            ]), id);

        llListenRemove(textHandle);
        textHandle = 0;
        llSetTimerEvent(0.0);
    }

    timer()
    {
        if (textHandle) llListenRemove(textHandle);
        textHandle = 0;
        llSetTimerEvent(0.0);
    }
}
