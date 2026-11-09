/* Lantern Trail: the cartwheel starter game. Replace it with yours.
 *
 * One or two players (split screen) climb a cliff trail, find three lanterns
 * in order and then light the beacon at the top. Falling into the chasm puts
 * a player back at the last lantern found. Small on purpose: it shows the
 * shape of a cartwheel game and the defaults a good one keeps.
 *
 * What the engine does for you (cartwheel/shell.h): the loading, title, join,
 * pause and settings screens, the graphics presets (Very Low to Ultra, Auto),
 * saved settings and save data, menu input (pad, keyboard, touch), the music
 * and effects volume, text size, split screen. This file answers its hooks.
 *
 * The world is main.cwscene (and scenes/: the player, a lantern, a tree, a
 * crate), made of the engine's node types: a procedural sky and a low sun
 * with cascaded shadows, volumetric height fog, a Terrain3D canyon with
 * grass, rock and tree scatter, static bodies for the level, rigid bodies
 * for the crates and a CharacterBody3D per player. The art (PBR texture
 * sets, the models that dress the level's blocks, the clouds, the terrain's
 * maps) is made by tools/make-art.mjs; dress_models() below puts the models
 * on the nodes that name them.
 *
 * The shape of the game:
 *   - init(): the input map (project.cwproj input.*), the shell, the sounds,
 *     the debug fields the checks read, the `grounding` command.
 *   - start(): the shell's Play: the world as authored, for n players.
 *   - fixed_update(): one tick (60 a second), only while cw_shell_update()
 *     says play is on: move the players, the cues, the lanterns, the beacon.
 *   - render(): the HUD in each player's view while cw_shell_hud_shown(),
 *     then cw_shell_draw() for the menus.
 *
 * On-screen cues (what a newcomer reads, and what tests/newcomer.mjs plays
 * from): the arrow at the top of each view points at the next lantern or the
 * beacon (debug field cue.arrow: x right, y up on screen, per player), and the
 * {jump} prompt shows in front of every step and the gap (cue.jump). A player
 * who follows them finishes; tests/game.json says which fields they are.
 *
 * <app>_auto is the same game built with GAME_AUTOPILOT: one player, straight
 * into play, steered by those same cues. Screenshots and checks that need
 * play without the menus run it.
 *
 * Determinism: the simulation runs only in fixed_update, from the input
 * snapshot; never the wall clock. The same inputs give the same game on every
 * host. Debug fields: game.ticks, game.players, game.lanterns, game.done,
 * game.finish_ticks, game.respawns, game.hash, cue.arrow, cue.jump, cue.goal. */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cartwheel/anim.h"
#include "cartwheel/audio.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#include "cartwheel/input.h"
#include "cartwheel/physics_nodes.h"
#include "cartwheel/project.h"
#include "cartwheel/prompt.h"
#include "cartwheel/quality.h"
#include "cartwheel/render2d.h"
#include "cartwheel/resource.h"
#include "cartwheel/scene_file.h"
#include "cartwheel/shell.h"
#include "cartwheel/ui.h"

#define MAX_PLAYERS 2
#define LANTERNS 3

#include "flash_meter.h"

void grounding_register(void); /* src/grounding.c */

/* The flash meters (src/flash_meter.c): every effect that changes the light on screen feeds the value it draws, and
 * tests/flash.mjs holds each to at most 3 flashes a second. Effects swell and fade over 6 to 30 ticks; none flashes. */
static flash_meter fl_lantern, fl_beacon, fl_respawn;

typedef struct save_data {
  int32_t best_ticks; /* the fastest trail, in ticks (0: never finished) */
} save_data;

static struct {
  int32_t ticks, players, lanterns, done, finish_ticks, respawns, goal;
  uint32_t hash;                  /* positions and progress folded every tick: GL and WebGPU must agree */
  float arrow[MAX_PLAYERS * 2];   /* the HUD arrow per player: screen direction to the next goal */
  int32_t jump_cue[MAX_PLAYERS];  /* 1 while the {jump} prompt shows in that player's view */
  int32_t in_hint[MAX_PLAYERS];   /* jump-hint areas the player is inside */
  int32_t fade[MAX_PLAYERS];      /* ticks left of the respawn fade (FADE_TICKS: in over 6, hold 6, out over 24) */
  int32_t burst;                  /* ticks left of a found lantern's burst of light (BURST_TICKS), then it goes */
  cw_node burst_node;
  int32_t air[MAX_PLAYERS];       /* ticks since the player left the ground (coyote time) */
  int32_t buffered[MAX_PLAYERS];  /* ticks left of a jump pressed just before landing (jump buffer) */
  float facing[MAX_PLAYERS];
  int32_t clip[MAX_PLAYERS];      /* the clip each body plays (CLIP_*) */
  t3_vec3 target[LANTERNS + 1];   /* the lanterns in order, then the beacon */
  t3_vec3 checkpoint;
  float beacon;                   /* 0..1: the beacon's flame swelling once every lantern is found */
  float fade_drawn;               /* the respawn dip as drawn (through its flash meter) */
  int32_t best;
} G;

static cw_action left, right, forward, back, jump, accept;
static cw_sound snd_lantern, snd_beacon, snd_fall, snd_move, snd_select, snd_back, snd_music;
static cw_voice music;

static cw_node level(void) { return cw_node_get(cw_tree_root(cw_scene_app_tree()), "Level"); }
static cw_node named(const char *fmt, int i) {
  char name[32];
  snprintf(name, sizeof name, fmt, i + 1);
  return cw_node_get(level(), name);
}
static cw_node player_node(int i) { return named("Player%d", i); }
static cw_node camera_node(int i) { return named("Camera%d", i); }
static int player_of(cw_node body) {
  for (int i = 0; i < G.players; i++)
    if (body.id == player_node(i).id) return i;
  return -1;
}

/* ── sounds: a few sine sweeps so the repository needs no audio files ─ */

static cw_sound tone(float hz, float seconds, float hz_end, float gain) {
  enum { RATE = 48000 };
  static float pcm[RATE * 2];
  int n = CW_MIN((int)(seconds * RATE), RATE * 2);
  double phase = 0;
  for (int i = 0; i < n; i++) {
    float t = (float)i / (float)n;
    phase += 2 * 3.14159265358979 * (hz + (hz_end - hz) * t) / RATE;
    pcm[i] = (float)sin(phase) * gain * (1 - t) * fminf(1, t * 40);
  }
  return cw_sound_from_pcm(pcm, n, 1, RATE, NULL);
}
static void play(cw_sound s) { cw_audio_play(s, &(cw_play_desc){ .bus = cw_shell_sfx_bus() }); }

static void shell_sound(cw_shell_sound s, void *user) {
  (void)user;
  play(s == CW_SHELL_SND_MOVE ? snd_move : s == CW_SHELL_SND_BACK ? snd_back : snd_select);
}
static void shell_screen(cw_shell_screen from, cw_shell_screen to, void *user) {
  (void)from, (void)user;
  bool want = to == CW_SHELL_TITLE || to == CW_SHELL_PLAY;
  if (want && !cw_voice_is_playing(music)) music = cw_audio_play(snd_music, &(cw_play_desc){ .bus = cw_shell_music_bus(), .loop = true });
  if (!want && cw_voice_is_playing(music)) cw_voice_stop(music, 0.3f);
}

/* ── signals from the level's areas ─────────────────────────────────── */

#define BURST_TICKS 18
#define FADE_TICKS 36

/* a found lantern swells to three times its glow over 6 ticks, then fades out over 12 and goes */
static float burst_value(void) {
  int t = BURST_TICKS - G.burst; /* 0 .. BURST_TICKS */
  return G.burst <= 0 ? 0 : t < 6 ? (1 + 2 * t / 6.0f) / 3 : (BURST_TICKS - t) / 12.0f;
}
/* the dip to dark after a fall: in over 6 ticks, held 6, out over 24 */
static float fade_value(int i) {
  int t = FADE_TICKS - G.fade[i];
  return G.fade[i] <= 0 ? 0 : t < 6 ? 0.7f * t / 6.0f : t < 12 ? 0.7f : 0.7f * (FADE_TICKS - t) / 24.0f;
}

static void lantern_found(cw_node lantern, const cw_value *args, int argc, void *user) {
  int idx = (int)(intptr_t)user, p = argc > 0 ? player_of(args[0].node) : -1;
  if (p < 0 || idx != G.lanterns) return; /* in order: the arrow only ever shows the next one */
  G.lanterns++;
  G.goal = G.lanterns;
  G.checkpoint = (t3_vec3){ G.target[idx].x, G.target[idx].y + 0.2f, G.target[idx].z + 1.3f };
  if (G.burst_node.id) cw_node_free(G.burst_node);
  G.burst_node = lantern; /* it bursts, then goes (fixed_update) */
  G.burst = BURST_TICKS;
  play(G.lanterns == LANTERNS ? snd_beacon : snd_lantern);
  cw_input_rumble(p, 0.25f, 0.45f, 140); /* felt in the pad: no camera shake, ever */
}

static void goal_entered(cw_node goal, const cw_value *args, int argc, void *user) {
  (void)goal, (void)user;
  if (argc < 1 || player_of(args[0].node) < 0 || G.lanterns < LANTERNS || G.done) return;
  G.done = 1;
  G.finish_ticks = G.ticks;
  if (!G.best || G.ticks < G.best) {
    G.best = G.ticks;
    ((save_data *)cw_shell_game_save())->best_ticks = G.best;
    cw_shell_save_commit();
  }
}

static void hint_entered(cw_node area, const cw_value *args, int argc, void *user) {
  (void)area, (void)user;
  int p = argc > 0 ? player_of(args[0].node) : -1;
  if (p >= 0) G.in_hint[p]++;
}
static void hint_exited(cw_node area, const cw_value *args, int argc, void *user) {
  (void)area, (void)user;
  int p = argc > 0 ? player_of(args[0].node) : -1;
  if (p >= 0 && G.in_hint[p] > 0) G.in_hint[p]--;
}

/* ── models: tools/make-art.mjs writes them; a node in the group named by a model's path shows that model ── */

static const char *const MODELS[] = { "models/trail.glb", "models/scatter.glb", "models/scatter_detail.glb", "models/clouds.glb",
                                      "models/tree.glb", "models/crate.glb" };

/* A graphics setting of the game's own (Settings > Graphics, saved with the rest, set by the presets): the extra grass
 * and pebbles of models/scatter_detail.glb from Medium up. Render-only: nothing in the simulation reads it. */
static int scenery_lever = -1;
static void apply_quality(cw_quality q, void *user) {
  (void)q, (void)user;
  cw_node n = cw_node_get(level(), "ScatterDetail");
  if (n.id) cw_node_set(n, "visible", cw_val_bool(cw_gfx_get(scenery_lever) > 0));
}

static void shadows_on(t3_object *o, void *user) {
  (void)user;
  o->cast_shadow = o->receive_shadow = true;
}

static void dress_models(void) {
  for (size_t m = 0; m < sizeof MODELS / sizeof MODELS[0]; m++) {
    cw_res res = cw_res_load(MODELS[m], CW_RES_GLTF); /* loaded once, then shared */
    cw_node *nodes;
    int n = cw_tree_group(cw_scene_app_tree(), MODELS[m], &nodes);
    for (int i = 0; i < n; i++) {
      t3_object *o = cw_gltf_instantiate(res);
      if (!o) { cw_error("%s did not load: run node tools/make-art.mjs, and list it in roots.txt", MODELS[m]); return; }
      if (!cw_node_in_group(nodes[i], "airborne")) t3_object_traverse(o, shadows_on, NULL); /* not the sky's clouds */
      t3_object_add(cw_node3d_object(nodes[i]), o);
      t3_release(o); /* the node's object keeps it */
    }
  }
}

/* ── the players' bodies: skinned characters from tools/characters/make-characters.mjs, with their clips ── */

static const char *const CLIP_NAMES[] = { "idle", "walk", "run", "jump" };
enum { CLIP_IDLE, CLIP_WALK, CLIP_RUN, CLIP_JUMP };
/* the ground speed each clip covers at speed 1 (two strides a cycle, measured from the clip's planted foot): the
 * playback speed follows the body's, so the planted foot stays put */
static const float CLIP_SPEED[] = { 0, 1.5f, 3.4f, 0 };

static void dress_player(int i) {
  cw_node rig = cw_node_get(player_node(i), "Rig"), model = cw_node_get(rig, "Model"), anim = cw_node_get(rig, "Anim");
  cw_res res = cw_res_load(i == 0 ? "models/hiker.glb" : "models/hiker_blue.glb", CW_RES_GLTF);
  const cw_gltf *g = cw_res_gltf(res);
  t3_object *o = g ? cw_gltf_instantiate(res) : NULL;
  if (!o) { cw_error("models/hiker.glb did not load: run node tools/characters/make-characters.mjs, and list it in roots.txt"); return; }
  t3_object_traverse(o, shadows_on, NULL);
  t3_object_add(cw_node3d_object(model), o);
  t3_release(o);
  for (int k = 0; k < g->gltf->animation_count; k++) { /* the clips, bound to the bones under Model */
    cw_anim a = cw_anim_from_t3_clip(g->gltf->animations[k], "Model");
    cw_anim_set_stored(a, false);
    cw_anim_player_add(anim, g->gltf->animations[k]->name, a);
    cw_anim_release(a);
  }
  cw_anim_player_play(anim, "idle", 0);
  G.clip[i] = CLIP_IDLE;
}

/* the clip for what the body does now, and its playback speed */
static void animate_player(int i, bool on_floor, float speed) {
  cw_node anim = cw_node_get(cw_node_get(player_node(i), "Rig"), "Anim");
  int want = !on_floor ? CLIP_JUMP : speed > 2.4f ? CLIP_RUN : speed > 0.3f ? CLIP_WALK : CLIP_IDLE;
  if (want != G.clip[i]) {
    cw_anim_player_play(anim, CLIP_NAMES[want], want == CLIP_JUMP ? 0.08f : 0.2f);
    G.clip[i] = want;
  }
  float k = CLIP_SPEED[want] > 0 ? speed / CLIP_SPEED[want] : 1;
  cw_node_set(anim, "speed_scale", cw_val_float(k));
}

/* ── the shell's Play: the world as authored, for n players ─────────── */

static void start(int players, void *user) {
  (void)user;
  cw_scene_app_change_scene("main.cwscene", false);
  dress_models();
  apply_quality(cw_quality_get(), NULL);
  int32_t best = G.best;
  memset(&G, 0, sizeof G);
  G.best = best;
  G.players = players;
  for (int i = players; i < MAX_PLAYERS; i++) { /* nobody plays these */
    cw_node_free(player_node(i));
    cw_node_free(camera_node(i));
  }
  for (int i = 0; i < LANTERNS; i++) {
    cw_node l = named("Lantern%d", i);
    G.target[i] = cw_node3d_position(l);
    cw_connect(l, "body_entered", l, NULL, lantern_found, (void *)(intptr_t)i, 0);
  }
  cw_node goal = cw_node_get(level(), "Goal");
  G.target[LANTERNS] = cw_node3d_position(goal);
  cw_connect(goal, "body_entered", goal, NULL, goal_entered, NULL, 0);
  cw_node *hints;
  int n = cw_tree_group(cw_scene_app_tree(), "jump_hints", &hints);
  for (int i = 0; i < n; i++) {
    cw_connect(hints[i], "body_entered", hints[i], NULL, hint_entered, NULL, 0);
    cw_connect(hints[i], "body_exited", hints[i], NULL, hint_exited, NULL, 0);
  }
  G.checkpoint = cw_node3d_position(player_node(0));
  for (int i = 0; i < players; i++) dress_player(i);
  cw_node cams[MAX_PLAYERS];
  for (int i = 0; i < players; i++) cams[i] = camera_node(i);
  cw_shell_split(NULL, cams); /* one view per player */
}

static void init(void *user) {
  (void)user;
  cw_project_load_input();
  left = cw_action_find("move_left");
  right = cw_action_find("move_right");
  forward = cw_action_find("move_forward");
  back = cw_action_find("move_back");
  jump = cw_action_find("jump");
  /* Graphics: Auto is the first choice (a saved choice wins): it steps the preset down, Very Low at the bottom,
   * until the frame fits, and never lowers the resolution (cw_quality_full_resolution stays on). */
  cw_quality_auto(true, 0);
  cw_shell_init(&(cw_shell_desc){
    .title = "Lantern Trail",
    .subtitle = "light the beacon",
    .max_players = MAX_PLAYERS,
    .game_save_size = sizeof(save_data),
    .game_save_version = 1,
    .start = start,
    .sound = shell_sound,
    .screen_changed = shell_screen,
  });
  accept = cw_action_find("ui_accept"); /* the shell defines it */
  static const char *const scenery[] = { "Sparse", "Full" };
  scenery_lever = cw_quality_lever_add("Scenery", scenery, 2, (cw_quality_lever_presets){ .very_low = 0, .low = 0, .medium = 1, .high = 1, .ultra = 1 });
  cw_quality_on_change(apply_quality, NULL);
  snd_lantern = tone(660, 0.35f, 1320, 0.35f); /* sounds after the shell, which starts the mixer */
  snd_beacon = tone(440, 1.2f, 880, 0.35f);
  snd_fall = tone(400, 0.4f, 120, 0.3f);
  snd_move = tone(660, 0.05f, 660, 0.2f);
  snd_select = tone(520, 0.12f, 1040, 0.25f);
  snd_back = tone(520, 0.12f, 260, 0.25f);
  snd_music = tone(110, 2.0f, 110, 0.1f); /* a drone: replace it with your music */
  G.best = ((save_data *)cw_shell_game_save())->best_ticks;
  cw_debug_i32("game.ticks", &G.ticks);
  cw_debug_i32("game.players", &G.players);
  cw_debug_i32("game.lanterns", &G.lanterns);
  cw_debug_i32("game.done", &G.done);
  cw_debug_i32("game.finish_ticks", &G.finish_ticks);
  cw_debug_i32("game.respawns", &G.respawns);
  cw_debug_u32("game.hash", &G.hash);
  cw_debug_f32_array("cue.arrow", G.arrow, MAX_PLAYERS * 2);
  cw_debug_field("cue.jump", G.jump_cue, CW_DBG_I32, MAX_PLAYERS);
  cw_debug_i32("cue.goal", &G.goal);
  grounding_register();
  flash_meter_init(&fl_lantern, "lantern");
  flash_meter_init(&fl_beacon, "beacon");
  flash_meter_init(&fl_respawn, "respawn");
  flash_meter_register(&fl_lantern);
  flash_meter_register(&fl_beacon);
  flash_meter_register(&fl_respawn);
#ifdef GAME_AUTOPILOT
  cw_shell_start(1); /* straight into play, no menus */
#endif
}

/* ── one tick ───────────────────────────────────────────────────────── */

/* where player i wants to go: the actions, or (autopilot) the player's own on-screen cues */
static void steer(int i, float *sx, float *sz, bool *jumping) {
#ifdef GAME_AUTOPILOT
  *sx = G.arrow[i * 2];
  *sz = -G.arrow[i * 2 + 1]; /* screen up is forward, -z */
  *jumping = G.jump_cue[i] != 0;
#else
  *sx = cw_input_axis(i, left, right);
  *sz = cw_input_axis(i, forward, back);
  *jumping = cw_action_just_pressed(i, jump);
#endif
}

static void move_player(int i, float dt) {
  const float speed = 5.5f, accel = 45, gravity = 20, jump_speed = 7.5f;
  cw_node p = player_node(i);
  cw_value v;
  cw_node_get_prop(p, "velocity", &v);
  float vx = v.v[0], vy = v.v[1], vz = v.v[2];
  cw_node_get_prop(p, "on_floor", &v);
  bool on_floor = v.b, jumping;
  float sx, sz;
  steer(i, &sx, &sz, &jumping);
  float len = sqrtf(sx * sx + sz * sz);
  if (len > 1) sx /= len, sz /= len; /* a diagonal is no faster */
  float k = accel * dt;
  vx += CW_CLAMP(sx * speed - vx, -k, k);
  vz += CW_CLAMP(sz * speed - vz, -k, k);
  /* forgiving jumps: a press a few ticks before landing still jumps (buffer), and so does one a few ticks after
   * running off an edge (coyote time). A newcomer's late or early press should not cost a life. */
  G.air[i] = on_floor ? 0 : G.air[i] + 1;
  G.buffered[i] = jumping ? 8 : G.buffered[i] > 0 ? G.buffered[i] - 1 : 0;
  if (G.buffered[i] && G.air[i] < 9) {
    vy = jump_speed;
    G.buffered[i] = 0;
    G.air[i] = 9;
    play(snd_move);
  }
  vy -= gravity * dt;
  cw_node_set(p, "velocity", cw_val_vec3(vx, vy, vz));
  cw_character3d_move_and_slide(p, dt);
  t3_vec3 pos = cw_node3d_position(p);
  if (pos.y < -4) { /* into the chasm: back to the last lantern found */
    pos = G.checkpoint;
    pos.x += i * 0.8f;
    cw_node3d_set_position(p, pos);
    cw_node_set(p, "velocity", cw_val_vec3(0, 0, 0));
    G.respawns++;
    G.fade[i] = FADE_TICKS;
    play(snd_fall);
  }
  if (G.fade[i]) G.fade[i]--;

  /* the body: face the way it moves; the clip follows what it does */
  float hs = sqrtf(vx * vx + vz * vz);
  if (hs > 0.3f) {
    float want = atan2f(-vx, -vz), d = want - G.facing[i];
    while (d > 3.14159f) d -= 6.28318f;
    while (d < -3.14159f) d += 6.28318f;
    G.facing[i] += d * 0.25f;
  }
  cw_node_set(cw_node_get(p, "Rig"), "rotation", cw_val_vec3(0, G.facing[i], 0));
  cw_node_get_prop(p, "on_floor", &v);
  animate_player(i, v.b || G.air[i] < 6, hs);

  /* the camera follows from behind and above (eased, so it never jerks) */
  cw_node cam = camera_node(i);
  t3_vec3 c = cw_node3d_position(cam), want = { pos.x, pos.y + 4.2f, pos.z + 7 };
  float e = G.ticks == 0 || G.fade[i] == FADE_TICKS - 6 ? 1 : 0.12f; /* snaps while the view is dark */
  cw_node3d_set_position(cam, (t3_vec3){ c.x + (want.x - c.x) * e, c.y + (want.y - c.y) * e, c.z + (want.z - c.z) * e });

  /* the cues this player's view shows: the arrow to the next goal, the jump prompt */
  t3_vec3 t = G.target[G.goal];
  float dx = t.x - pos.x, dz = t.z - pos.z, d = sqrtf(dx * dx + dz * dz);
  G.arrow[i * 2] = d > 0.01f ? dx / d : 0;
  G.arrow[i * 2 + 1] = d > 0.01f ? -dz / d : 0;
  G.jump_cue[i] = G.in_hint[i] > 0;

  int32_t q[4] = { (int32_t)(pos.x * 1000), (int32_t)(pos.y * 1000), (int32_t)(pos.z * 1000), G.lanterns };
  const uint8_t *b = (const uint8_t *)q;
  for (size_t j = 0; j < sizeof q; j++) G.hash = (G.hash ^ b[j]) * 16777619u;
}

static void fixed_update(void *user, double dt) {
  (void)user;
  if (!cw_shell_update()) return; /* a menu is up: the world holds still */
  if (G.done) { /* the trail is finished: accept plays it again */
#ifdef GAME_AUTOPILOT
    if (G.ticks - G.finish_ticks > 240) { start(G.players, NULL); return; } /* the autopilot goes round again */
#endif
    for (int i = 0; i < G.players; i++)
      if (cw_action_just_pressed(i, accept) && G.ticks - G.finish_ticks > 60) {
        start(G.players, NULL);
        return;
      }
  }
  if (!G.done)
    for (int i = 0; i < G.players; i++) move_player(i, (float)dt);
  /* the found lantern's burst: its light drawn through the flash meter */
  float b = flash_meter_feed(&fl_lantern, burst_value());
  if (G.burst_node.id) {
    cw_node_set(cw_node_get(G.burst_node, "Glow"), "energy", cw_val_float(18 * b));
    cw_node_set(cw_node_get(G.burst_node, "Glass"), "emissive", cw_val_color(3.2f * 3 * b, 1.7f * 3 * b, 0.55f * 3 * b, 1));
    if (--G.burst <= 0) { cw_node_free(G.burst_node); G.burst_node = (cw_node){ 0 }; }
  }
  float dark = 0;
  for (int i = 0; i < G.players; i++) dark = fmaxf(dark, fade_value(i));
  G.fade_drawn = flash_meter_feed(&fl_respawn, dark);
  /* the beacon's flame swells over a second once every lantern is found (a swell, never a flash) */
  if (G.lanterns == LANTERNS && G.beacon < 1) G.beacon = fminf(1, G.beacon + (float)dt);
  float k = flash_meter_feed(&fl_beacon, G.beacon * G.beacon * (3 - 2 * G.beacon));
  if (k > 0 || fl_beacon.strobe) {
    cw_node beacon = cw_node_get(level(), "Beacon");
    cw_node_set(cw_node_get(beacon, "Flame"), "emissive", cw_val_color(6.0f * k, 2.0f * k, 0.35f * k, 1));
    cw_node_set(cw_node_get(beacon, "Light"), "energy", cw_val_float(40 * k));
  }
  G.ticks++;
}

/* ── the HUD in each player's view, then the shell's menus ──────────── */

/* text centred on x (cw_r2d_text draws from its left edge) */
static void text_centered(cw_font font, const char *s, float x, float y, cw_text_style st) {
  cw_text_metrics m = cw_font_measure(font, s, &st);
  cw_r2d_text(font, s, cw_v2(x - m.width * 0.5f, y), &st);
}

static void hud(int i, cw_font font, float size) {
  cw_rect r = cw_shell_player_rect(i);
  cw_text_style st = { .size = size, .outline_width = size * 0.08f };
  char s[64];
  snprintf(s, sizeof s, "Lanterns %d / %d", G.lanterns, LANTERNS);
  cw_r2d_text(font, s, cw_v2(r.x + size * 0.7f, r.y + size * 0.5f), &st);
  if (!G.done) {
    /* the arrow to the next goal, top centre */
    cw_vec2 c = cw_v2(r.x + r.w * 0.5f, r.y + size * 1.6f);
    float ax = G.arrow[i * 2], ay = -G.arrow[i * 2 + 1], L = size * 1.1f; /* canvas y grows down */
    cw_vec2 tip = cw_v2(c.x + ax * L, c.y + ay * L), l = cw_v2(c.x - ay * L * 0.55f - ax * L * 0.5f, c.y + ax * L * 0.55f - ay * L * 0.5f),
            rr = cw_v2(c.x + ay * L * 0.55f - ax * L * 0.5f, c.y - ax * L * 0.55f - ay * L * 0.5f);
    cw_r2d_circle(c, L * 1.25f, 32, cw_rgba(0, 0, 0, 0.45f));
    cw_r2d_polygon((cw_vec2[]){ tip, l, c, rr }, 4, cw_rgba(1, 0.78f, 0.35f, 1));
    const char *what = G.goal < LANTERNS ? "find the lantern" : "light the beacon";
    text_centered(font, what, c.x, c.y + L * 1.4f, (cw_text_style){ .size = size * 0.85f, .outline_width = size * 0.07f });
    if (G.jump_cue[i])
      cw_prompt_text(font, "{jump} jump", i, cw_v2(r.x + r.w * 0.5f, r.y + r.h * 0.62f), size * 1.1f, (cw_color){ 0 }, CW_ALIGN_CENTER);
    if (G.ticks < 60 * 12) /* the controls, for the first seconds */
      cw_prompt_text(font, "{move_left|move_right|move_forward|move_back} move    {jump} jump", i,
                     cw_v2(r.x + r.w * 0.5f, r.y + r.h - size * 2.0f), size, (cw_color){ 0 }, CW_ALIGN_CENTER);
  } else {
    cw_rect panel = { r.x + r.w * 0.5f - size * 9, r.y + r.h * 0.58f, size * 18, size * 6.2f };
    cw_r2d_round_rect(panel, size * 0.5f, 8, cw_rgba(0, 0, 0, 0.6f));
    text_centered(font, "The beacon is lit!", panel.x + panel.w * 0.5f, panel.y + size * 0.7f, (cw_text_style){ .size = size * 1.6f });
    int t = G.finish_ticks, b = G.best;
    snprintf(s, sizeof s, "time %d:%02d   best %d:%02d", t / 3600, t / 60 % 60, b / 3600, b / 60 % 60);
    text_centered(font, s, panel.x + panel.w * 0.5f, panel.y + size * 2.8f, (cw_text_style){ .size = size });
    cw_prompt_text(font, "{ui_accept} play again", i, cw_v2(panel.x + panel.w * 0.5f, panel.y + size * 4.4f), size, (cw_color){ 0 }, CW_ALIGN_CENTER);
  }
  if (G.fade[i] || fl_respawn.strobe) /* the dip to dark after a fall, as its flash meter passed it */
    cw_r2d_rect(r, cw_rgba(0, 0, 0, G.fade_drawn));
}

static void render(void *user, double alpha) {
  (void)user, (void)alpha;
  cw_quality_auto_measure(cw_shell_hud_shown()); /* Auto times play only, not the menus */
  if (cw_shell_hud_shown()) { /* not under the pause menu or settings */
    cw_r2d_begin(NULL);
    float size = cw_r2d_canvas_size().y * 0.036f; /* body text: over the 2.4% floor (cartwheel/render2d.h) */
    for (int i = 0; i < G.players; i++) hud(i, cw_ui_font_sans(), size);
    cw_r2d_end();
  }
  cw_shell_draw();
}

cw_app_desc cw_main(int argc, char **argv) {
  (void)argc, (void)argv;
  cw_scene_register_builtin_types();
  static cw_app_desc app = { .width = 960, .height = 540, .debug = true, .init = init, .fixed_update = fixed_update, .render = render };
  cw_project_apply_app(&app); /* render.* and the name from project.cwproj */
  app.save = cw_shell_save_region(); /* settings + save_data, kept between runs */
  app.save_size = cw_shell_save_region_size();
  return cw_scene_app("main.cwscene", &app);
}
