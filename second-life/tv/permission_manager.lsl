// ===========================================================================
//  Musical Impact Smart TV - permission_manager.lsl
// ---------------------------------------------------------------------------
//  Decides who may control the TV, in world.
//
//  Four modes, as required:
//    owner     only the object owner
//    group     anyone whose ACTIVE group matches the object group
//    everyone  anyone present
//    host      one person the owner appoints, at a time
//
//  IMPORTANT: this is not the only permission check, and it is not the final
//  one. The backend re-checks every command against its own copy of the mode
//  before it changes anything or tells other viewers. This script exists
//  because group membership can ONLY be answered in world - llSameGroup is the
//  sole source of that fact - and because the local buttons must keep working
//  when the backend is unreachable.
//
//  llSameGroup checks the avatar ACTIVE group, not their memberships. Someone
//  in the group who is wearing a different tag will be refused, which is the
//  documented behaviour and worth telling users rather than treating as a bug.
// ===========================================================================

integer MI_NET_SEND    = 100;
integer MI_NET_RECV    = 101;
integer MI_CFG_GET     = 120;
integer MI_CFG_VALUE   = 121;
integer MI_CFG_SET     = 122;
integer MI_PERM_CHECK  = 130;
integer MI_PERM_RESULT = 131;

string  mode = "owner";
key     hostKey = NULL_KEY;
string  hostName = "";

integer allowed(key av)
{
    if (av == NULL_KEY) return FALSE;
    if (av == llGetOwner()) return TRUE;

    if (mode == "everyone") return TRUE;
    if (mode == "group")    return llSameGroup(av);
    if (mode == "host")     return (av == hostKey);

    return FALSE;               // owner mode
}

string refusal(key av)
{
    if (mode == "owner")    return "Only the owner can control this TV.";
    if (mode == "group")    return "This TV is set to group members. Activate the object group tag to use it.";
    if (mode == "host")
    {
        if (hostKey == NULL_KEY) return "No host has been appointed yet.";
        return hostName + " currently has control.";
    }
    return "You do not have control of this TV.";
}

setMode(string m)
{
    if (m != "owner" && m != "group" && m != "everyone" && m != "host") return;
    mode = m;
    llMessageLinked(LINK_SET, MI_CFG_SET, "permission_mode|" + m, NULL_KEY);

    // Leaving host mode releases whoever held it, so control cannot linger.
    if (m != "host")
    {
        hostKey = NULL_KEY;
        hostName = "";
    }
    llOwnerSay("Smart TV: control mode is now " + m + ".");
}

setHost(key av, string name)
{
    string action = "release";
    if (av != NULL_KEY) action = "claim";

    hostKey = av;
    hostName = name;
    if (av == NULL_KEY) llOwnerSay("Smart TV: host released.");
    else llOwnerSay("Smart TV: " + name + " is now the host.");

    llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/command|"
        + llList2Json(JSON_OBJECT, [
            "tvId", (string)llGetKey(),
            "c",    "host",
            "a",    action,
            "k",    (string)av,
            "n",    name
        ]), av);
}

default
{
    state_entry()
    {
        llMessageLinked(LINK_SET, MI_CFG_GET, "permission_mode", NULL_KEY);
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_PERM_CHECK)
        {
            if (allowed(id))
            {
                llMessageLinked(LINK_SET, MI_PERM_RESULT, "1|" + str, id);
            }
            else
            {
                llMessageLinked(LINK_SET, MI_PERM_RESULT, "0|" + refusal(id), id);
            }
            return;
        }

        if (num == MI_CFG_VALUE)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            if (llGetSubString(str, 0, bar - 1) == "permission_mode")
            {
                string v = llGetSubString(str, bar + 1, -1);
                if (v != "") mode = v;
            }
            return;
        }

        // "mode|everyone" or "host|<key>|<name>" from the owner menu.
        if (num == MI_PERM_RESULT && sender == llGetLinkNumber()) return;

        if (num == MI_NET_RECV)
        {
            string c = llJsonGetValue(str, ["c"]);
            if (c == "cfg")
            {
                string k = llJsonGetValue(str, ["k"]);
                string v = llJsonGetValue(str, ["v"]);
                if (k == "permission_mode") setMode(v);
                else if (k == "host_clear")  setHost(NULL_KEY, "");
            }
            else if (c == "state")
            {
                string m = llJsonGetValue(str, ["mode"]);
                if (m != JSON_INVALID && m != "") mode = m;
            }
        }
    }

    changed(integer c)
    {
        if (c & CHANGED_OWNER)
        {
            // Never carry an old host or a permissive mode to a new owner.
            mode = "owner";
            hostKey = NULL_KEY;
            hostName = "";
            llMessageLinked(LINK_SET, MI_CFG_SET, "permission_mode|owner", NULL_KEY);
        }
    }
}
