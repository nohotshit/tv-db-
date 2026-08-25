// ===========================================================================
//  Musical Impact Smart TV - game_manager.lsl
// ---------------------------------------------------------------------------
//  Starts and stops games, and lets people join from the object menu.
//
//  The games themselves live on the backend and are drawn by the web
//  interface. This script does not implement any game rules, on purpose:
//    * the rules have to be authoritative somewhere, and that somewhere must
//      be able to keep secrets. A script in a prim cannot - anyone who can
//      take a copy of the object can read every script in it.
//    * a board drawn in prims would be a second implementation to maintain
//      and would not match what the screen shows.
//
//  So this is a launcher and a seat manager, which is the part that genuinely
//  needs to be in world: it knows who is standing here and who touched what.
// ===========================================================================

integer MI_NET_SEND = 100;
integer MI_NET_RECV = 101;
integer MI_GAME     = 180;
integer MI_ACTIVITY = 170;

string activeGame = "";

announce(string text)
{
    llSay(0, "[Smart TV] " + text);
}

string prettyName(string id)
{
    if (id == "tictactoe")   return "Tic-Tac-Toe";
    if (id == "connectfour") return "Connect Four";
    if (id == "rps")         return "Rock Paper Scissors";
    if (id == "trivia")      return "Trivia";
    if (id == "numberguess") return "Number Guessing";
    if (id == "reaction")    return "the Reaction Test";
    return id;
}

startGame(key av, string game)
{
    activeGame = game;

    llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/command|"
        + llList2Json(JSON_OBJECT, [
            "tvId", (string)llGetKey(),
            "c",    "game",
            "v",    "start:" + game,
            "k",    (string)av,
            "n",    llGetDisplayName(av)
        ]), av);

    announce(llGetDisplayName(av) + " started " + prettyName(game)
           + " on the TV. Touch the screen or use your remote to join.");
}

default
{
    state_entry()
    {
        activeGame = "";
    }

    link_message(integer sender, integer num, string str, key id)
    {
        if (num == MI_GAME)
        {
            integer bar = llSubStringIndex(str, "|");
            if (bar < 1) return;
            string action = llGetSubString(str, 0, bar - 1);
            string game   = llGetSubString(str, bar + 1, -1);

            llMessageLinked(LINK_SET, MI_ACTIVITY, "", id);

            if (action == "start") startGame(id, game);
            else if (action == "leave")
            {
                llMessageLinked(LINK_SET, MI_NET_SEND, "/api/lsl/command|"
                    + llList2Json(JSON_OBJECT, [
                        "tvId", (string)llGetKey(),
                        "c",    "game",
                        "v",    "leave:" + game,
                        "k",    (string)id
                    ]), id);
            }
            return;
        }

        if (num == MI_NET_RECV)
        {
            if (llJsonGetValue(str, ["c"]) != "game") return;

            string ev = llJsonGetValue(str, ["ev"]);
            string who = llJsonGetValue(str, ["n"]);

            if (ev == "win" && who != JSON_INVALID)
            {
                announce(who + " wins " + prettyName(activeGame) + ".");
            }
            else if (ev == "end")
            {
                activeGame = "";
            }
        }
    }
}
