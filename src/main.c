/* Gem Dash: the cartwheel starter game.
 *
 * One to four players run around an arena and grab gems; a grabbed gem pops
 * up somewhere else. That is all the gameplay there is: it is here to show
 * the shape of a cartwheel game, so copy it and replace the gameplay and the
 * art with yours.
 *
 * What the engine does for you (cartwheel/shell.h): the loading, title,
 * join, pause and settings screens, saved settings and save data, the menu
 * input (pad, keyboard, touch), the music and effects volume, the graphics
 * presets, split screen. This file only answers its callbacks.
 *
 * The shape of the game:
 *   - main.cwscene holds the world: floor, steps, gems, four players and
 *     four cameras (unused players are removed when a match starts).
 *   - init(): load the input map (project.cwproj input.*), start the shell,
 *     make the sounds, publish the debug fields the tests read.
 *   - start(): the shell's Play: reset the world for n players.
 *   - fixed_update(): one simulation tick (60 per second). Gameplay only runs
 *     when cw_shell_update() says so (not under a menu).
 *   - render(): the HUD (scores per player) over the 3D frame, then the
 *     shell's menus.
 *
 * Determinism: the simulation runs only in fixed_update, from the input
 * snapshot and cw_rng; never the wall clock. The same inputs give the same
 * game on every platform, which is what the tests check (tests/gates.json).
 *
 * gemdash_auto is the same game built with GEMDASH_AUTOPILOT: two bots
 * play a match with no input, for the tests and the screenshots.
 *
 * Debug fields: game.ticks, game.players, game.gems (per player),
 * game.total, game.best, game.hash. */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cartwheel/audio.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#include "cartwheel/input.h"
#include "cartwheel/physics_nodes.h"
#include "cartwheel/project.h"
#include "cartwheel/render2d.h"
#include "cartwheel/scene_file.h"
#include "cartwheel/shell.h"
#include "cartwheel/ui.h"

#define MAX_PLAYERS 4

/* the game's save data, kept by the shell next to the settings */
typedef struct save_data {
  int32_t best; /* the most gems grabbed in one match */
} save_data;

static struct {
  int32_t ticks, players, total, best;
  int32_t gems[MAX_PLAYERS];
  uint32_t hash; /* every tick's positions and scores folded: the tests compare it */
  cw_rng rng;
  t3_vec3 spawn[MAX_PLAYERS];
} G;

static cw_action left, right, forward, back, jump;
static cw_sound snd_gem, snd_move, snd_select, snd_back, snd_music;
static cw_voice music;

static cw_node level(void) { return cw_node_get(cw_tree_root(cw_scene_app_tree()), "Level"); }
static cw_node player_node(int i) {
  char name[24];
  snprintf(name, sizeof name, "Player%d", i + 1);
  return cw_node_get(level(), name);
}
static cw_node camera_node(int i) {
  char name[24];
  snprintf(name, sizeof name, "Camera%d", i + 1);
  return cw_node_get(level(), name);
}

/* ── sounds, made from a few sine waves so the repository needs no audio files ── */

static cw_sound tone(float hz, float seconds, float hz_end, float gain) {
  enum { RATE = 48000 };
  static float pcm[RATE * 2];
  int n = CW_MIN((int)(seconds * RATE), RATE * 2);
  double phase = 0;
  for (int i = 0; i < n; i++) {
    float t = (float)i / (float)n;
    phase += 2 * 3.14159265358979 * (hz + (hz_end - hz) * t) / RATE;
    pcm[i] = (float)sin(phase) * gain * (1 - t);
  }
  return cw_sound_from_pcm(pcm, n, 1, RATE, NULL);
}
static void play(cw_sound s, cw_bus bus) { cw_audio_play(s, &(cw_play_desc){ .bus = bus }); }

/* the shell's hooks: menu sounds, and music on the title and in play */
static void shell_sound(cw_shell_sound s, void *user) {
  (void)user;
  play(s == CW_SHELL_SND_MOVE ? snd_move : s == CW_SHELL_SND_BACK ? snd_back : snd_select, cw_shell_sfx_bus());
}
static void shell_screen(cw_shell_screen from, cw_shell_screen to, void *user) {
  (void)from, (void)user;
  bool want = to == CW_SHELL_TITLE || to == CW_SHELL_PLAY;
  if (want && !cw_voice_is_playing(music)) music = cw_audio_play(snd_music, &(cw_play_desc){ .bus = cw_shell_music_bus(), .loop = true });
  if (!want && cw_voice_is_playing(music)) cw_voice_stop(music, 0.3f);
}

/* ── gems ───────────────────────────────────────────────────────────── */

/* a gem somewhere new: one rng call per statement keeps every platform in step */
static void move_gem(cw_node gem) {
  float x = cw_rng_range(&G.rng, -10.0f, 10.0f);
  float z = cw_rng_range(&G.rng, -10.0f, 10.0f);
  cw_node3d_set_position(gem, (t3_vec3){ x, 0.8f, z });
}

static void grabbed(cw_node gem, const cw_value *args, int argc, void *user) {
  (void)user;
  if (argc < 1) return;
  for (int i = 0; i < G.players; i++)
    if (args[0].node.id == player_node(i).id) {
      G.gems[i]++;
      G.total++;
      move_gem(gem);
      play(snd_gem, cw_shell_sfx_bus());
      if (G.total > G.best) {
        G.best = G.total;
        ((save_data *)cw_shell_game_save())->best = G.best;
        cw_shell_save_commit();
      }
    }
}

/* ── the shell's Play: a fresh world for n players ─────────────────── */

static void start(int players, void *user) {
  (void)user;
  cw_scene_app_change_scene("main.cwscene", false); /* the world as authored */
  G.players = players;
  G.total = 0;
  G.ticks = 0;
  G.hash = 0;
  memset(G.gems, 0, sizeof G.gems);
  cw_rng_seed(&G.rng, 1234);
  for (int i = players; i < MAX_PLAYERS; i++) { /* nobody plays these */
    cw_node_free(player_node(i));
    cw_node_free(camera_node(i));
  }
  for (int i = 0; i < players; i++) G.spawn[i] = cw_node3d_position(player_node(i));
  cw_node *gems;
  int n = cw_tree_group(cw_scene_app_tree(), "gems", &gems);
  for (int i = 0; i < n; i++) cw_connect(gems[i], "body_entered", gems[i], NULL, grabbed, NULL, 0);
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
  cw_shell_init(&(cw_shell_desc){
    .title = "Gem Dash",
    .subtitle = "grab the gems",
    .max_players = MAX_PLAYERS,
    .game_save_size = sizeof(save_data),
    .game_save_version = 1,
    .start = start,
    .sound = shell_sound,
    .screen_changed = shell_screen,
  });
  /* sounds after the shell, which starts the mixer */
  snd_gem = tone(880, 0.15f, 1760, 0.4f);
  snd_move = tone(660, 0.05f, 660, 0.25f);
  snd_select = tone(520, 0.12f, 1040, 0.3f);
  snd_back = tone(520, 0.12f, 260, 0.3f);
  snd_music = tone(110, 2.0f, 110, 0.15f); /* a drone: replace with your music */
  G.best = ((save_data *)cw_shell_game_save())->best;
  cw_debug_i32("game.ticks", &G.ticks);
  cw_debug_i32("game.players", &G.players);
  cw_debug_field("game.gems", G.gems, CW_DBG_I32, MAX_PLAYERS);
  cw_debug_i32("game.total", &G.total);
  cw_debug_i32("game.best", &G.best);
  cw_debug_u32("game.hash", &G.hash);
#ifdef GEMDASH_AUTOPILOT
  cw_shell_start(2); /* straight into a two-player match, no menus */
#endif
}

/* ── one tick ───────────────────────────────────────────────────────── */

/* where player i wants to go: the actions, or (autopilot) the nearest gem */
static void steer(int i, t3_vec3 pos, float *tx, float *tz, bool *jumping) {
#ifdef GEMDASH_AUTOPILOT
  cw_node *gems;
  int n = cw_tree_group(cw_scene_app_tree(), "gems", &gems);
  float best = 1e9f, dx = 0, dz = 0;
  for (int g = 0; g < n; g++) {
    t3_vec3 p = cw_node3d_position(gems[g]);
    float d = (p.x - pos.x) * (p.x - pos.x) + (p.z - pos.z) * (p.z - pos.z);
    if (d < best) best = d, dx = p.x - pos.x, dz = p.z - pos.z;
  }
  float len = sqrtf(dx * dx + dz * dz);
  *tx = len > 0.01f ? dx / len : 0;
  *tz = len > 0.01f ? dz / len : 0;
  *jumping = (G.ticks + i * 20) % 90 == 0; /* a hop now and then, for the steps */
#else
  (void)pos;
  *tx = cw_input_axis(i, left, right);
  *tz = cw_input_axis(i, forward, back);
  *jumping = cw_action_just_pressed(i, jump);
#endif
}

static void fixed_update(void *user, double dt) {
  (void)user;
  if (!cw_shell_update()) return; /* a menu is up: the world holds still */
  const float speed = 5, accel = 40, gravity = 20, jump_speed = 7.5f;
  for (int i = 0; i < G.players; i++) {
    cw_node p = player_node(i);
    cw_value v;
    cw_node_get_prop(p, "velocity", &v);
    float vx = v.v[0], vy = v.v[1], vz = v.v[2];
    cw_node_get_prop(p, "on_floor", &v);
    bool on_floor = v.b, jumping;
    float tx, tz;
    t3_vec3 pos = cw_node3d_position(p);
    steer(i, pos, &tx, &tz, &jumping);
    float k = accel * (float)dt;
    vx += CW_CLAMP(tx * speed - vx, -k, k);
    vz += CW_CLAMP(tz * speed - vz, -k, k);
    if (on_floor && jumping) vy = jump_speed;
    vy -= gravity * (float)dt;
    cw_node_set(p, "velocity", cw_val_vec3(vx, vy, vz));
    cw_character3d_move_and_slide(p, (float)dt);
    pos = cw_node3d_position(p);
    if (pos.y < -10) { /* fell off: back to the start */
      pos = G.spawn[i];
      cw_node3d_set_position(p, pos);
      cw_node_set(p, "velocity", cw_val_vec3(0, 0, 0));
    }
    cw_node3d_set_position(camera_node(i), (t3_vec3){ pos.x, pos.y + 3.5f, pos.z + 7 }); /* follow */
    /* fold this player's state into the hash the tests compare */
    int32_t q[4] = { (int32_t)(pos.x * 1000), (int32_t)(pos.y * 1000), (int32_t)(pos.z * 1000), G.gems[i] };
    const uint8_t *b = (const uint8_t *)q;
    for (size_t j = 0; j < sizeof q; j++) G.hash = (G.hash ^ b[j]) * 16777619u;
  }
  G.ticks++;
}

/* ── the HUD, then the shell's menus ────────────────────────────────── */

static void render(void *user, double alpha) {
  (void)user, (void)alpha;
  if (cw_shell_screen_now() == CW_SHELL_PLAY || cw_shell_screen_now() == CW_SHELL_PAUSE) {
    cw_r2d_begin(NULL);
    cw_font font = cw_ui_font_sans();
    float size = cw_r2d_canvas_size().y / 22;
    for (int i = 0; i < G.players; i++) { /* each player's score in their own view */
      cw_rect r = cw_shell_player_rect(i);
      char s[32];
      snprintf(s, sizeof s, "P%d  %d gems", i + 1, G.gems[i]);
      cw_r2d_text(font, s, cw_v2(r.x + size * 0.6f, r.y + size * 0.4f),
                  &(cw_text_style){ .size = size, .outline_width = size * 0.08f });
    }
    cw_rect shared = cw_shell_shared_rect(); /* three players: the free quadrant */
    if (shared.w > 0) {
      char s[48];
      snprintf(s, sizeof s, "total %d   best %d", G.total, G.best);
      cw_r2d_rect(shared, cw_rgba(0, 0, 0, 0.6f));
      cw_r2d_text(font, s, cw_v2(shared.x + size, shared.y + shared.h * 0.45f), &(cw_text_style){ .size = size });
    }
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
