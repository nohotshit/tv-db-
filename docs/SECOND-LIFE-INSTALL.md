# Installing in Second Life

You need: a parcel where you can rez objects and where **media is enabled**, and
the backend already deployed (see [DEPLOYMENT.md](DEPLOYMENT.md)).

---

## Part 1 — the TV

### Build the prim

1. Rez a box and shape it like a screen. A good starting size is
   **2.0 × 0.1 × 1.15 m**, which is close to 16:9.
2. Note which face is the front. Edit → **Select Face** and click the front;
   for a default box it is usually face **0**. You will need this number.
3. Name the object something you will recognise.

### Add the scripts

Drag all eleven files from `second-life/tv/` into the object's **Contents**.
Order does not matter — they find each other over link messages.

They will complain about a missing notecard. That is expected; it is next.

### Configure

1. Create a notecard named exactly **`TV Config`**.
2. Paste in `second-life/scripts/TV Config.txt`.
3. Fill in:
   - `backend_url` — your backend, **no trailing slash**
   - `frontend_url` — your frontend, **with a trailing slash**
   - `shared_secret` — from the backend's Environment tab on Render
   - `media_face` — the face number from step 2
4. Save, and drop it into the object's Contents.

The scripts read it, copy everything into Linkset Data, and say so in chat.

> **Then delete the notecard from the object.** It holds your shared secret, and
> anyone who can take a copy of the object can read a notecard inside it. The
> settings survive without it — that is the whole point of Linkset Data.

### Check it worked

The screen should show the boot screen and then the home screen. In chat you
should see the configuration confirmation. On Render, the backend log should
show `[lsl] registered <object key> in <region>`.

If the screen stays blank, see Troubleshooting below.

---

## Part 2 — the remote HUD

1. Rez a second object, make it small and flat, and give it a face for its
   screen.
2. Drag `second-life/hud/hud_core.lsl` into its Contents.
3. Take it to inventory and **wear** it as a HUD.
4. **Touch the TV once.** That pairs them: the TV asks the backend for a token
   scoped to your avatar and sends it to your HUD on a region channel.

The HUD screen is now personal — it knows who you are, shows your favorites, and
can claim host. The TV screen never can, for the reason in
[LIMITATIONS.md](LIMITATIONS.md#1-a-media-face-cannot-tell-you-who-is-looking-at-it).

### Optional: physical buttons

The HUD works from its media face alone. If you want prim buttons too, link
child prims and **name each prim after its function**: `playpause`, `stop`,
`prev`, `next`, `volup`, `voldown`, `mute`, `power`, `up`, `down`, `left`,
`right`, `select`, `back`, `home`, `movies`, `youtube`, `music`, `twitch`,
`kick`, `browser`, `messages`, `games`, `settings`, `clock`.

`hud_core.lsl` dispatches on the touched prim's name, so you can re-skin and
re-link the HUD freely without editing the script. Any unrecognised prim opens
the dialog menu, so a half-built HUD is still usable.

---

## Part 3 — the logo

Two places, for two different situations.

**On screen** — replace `frontend/assets/branding/logo.png` in the repository
and redeploy, or set `LOGO_URL` on the frontend service. Used by the boot
screen, idle screen, status bar, HUD and About page.

**In world** — upload the logo to Second Life as a texture, right-click it in
inventory → **Copy Asset UUID**, and put that in `logo_uuid` in the notecard.
This is the fallback the idle screen uses when the web interface cannot be
reached, so the TV shows your branding instead of a blank prim even with the
cloud down.

---

## Permission modes

Owner menu → **Access**:

| Mode | Who can control |
|---|---|
| **Owner** | Only you |
| **Group** | Anyone whose **active** group tag matches the object's group |
| **Everyone** | Anyone standing at the TV |
| **Host** | One person you appoint, at a time |

Group mode checks the avatar's *active* group, not their memberships. Someone in
the group wearing a different tag will be refused — that is how `llSameGroup`
works, and it is worth telling your visitors.

---

## Troubleshooting

**The screen is blank or grey.**
Media must be enabled: check the parcel allows it, and that your own viewer has
media on and is set to auto-play. Some viewers require one click on the face
first. Confirm `media_face` matches the face you can actually see.

**"Cloud: offline" but the backend is up.**
On Render's free tier the service is probably asleep — the first request wakes
it after roughly 50 seconds. Check `backend_url` has no trailing slash. Look for
`[lsl] rejected request ... bad-signature` in the backend log, which means
`shared_secret` does not match.

**The HUD says "not paired".**
Touch the TV while wearing it. If it still fails, the token may have expired —
detach and re-attach, which re-requests one automatically.

**The TV worked, then stopped after a region restart.**
Expected, and it should recover on its own: the HTTP-in URL is destroyed by a
restart and `net_bridge.lsl` re-registers. Give it a minute, or use owner menu →
Settings → **Re-register**.

**Nothing at all responds.**
Owner menu → Settings → **Reset TV**. Settings are kept in Linkset Data and
survive the reset.

**Group members cannot control it.**
They need the object's group as their *active* tag, not merely membership.
