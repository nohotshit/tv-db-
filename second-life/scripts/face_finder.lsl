// ===========================================================================
//  Musical Impact Smart TV - face_finder.lsl   (TEMPORARY HELPER)
// ---------------------------------------------------------------------------
//  Second Life shows you which face you have selected, but never tells you its
//  NUMBER - and media_face in the config notecard needs the number.
//
//  Drop this in the prim, touch the face you want the screen on, and it says
//  the number in chat. Then DELETE this script and put the real ones in.
//
//  A default box has six faces, numbered 0 to 5. Which one is "the front"
//  depends on how the prim is rotated, so guessing is a waste of time when
//  asking takes five seconds.
// ===========================================================================

default
{
    state_entry()
    {
        llOwnerSay("Face finder ready. Touch the face you want the TV screen on.");
    }

    touch_start(integer n)
    {
        integer face = llDetectedTouchFace(0);

        if (face == TOUCH_INVALID_FACE)
        {
            llOwnerSay("Could not read that face. Make sure you are touching the "
                     + "prim surface directly rather than clicking from far away.");
            return;
        }

        llOwnerSay("That is face " + (string)face
                 + ".  Put   media_face = " + (string)face
                 + "   in your TV Config notecard.");

        // Flash the chosen face so it is obvious you picked the right one.
        llSetLinkPrimitiveParamsFast(LINK_THIS, [
            PRIM_COLOR, face, <1.0, 0.18, 0.18>, 1.0
        ]);
        llSetTimerEvent(1.5);
    }

    timer()
    {
        llSetTimerEvent(0.0);
        integer i;
        for (i = 0; i < llGetNumberOfSides(); i++)
        {
            llSetLinkPrimitiveParamsFast(LINK_THIS, [
                PRIM_COLOR, i, <1.0, 1.0, 1.0>, 1.0
            ]);
        }
    }
}
