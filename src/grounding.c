/* The `grounding` debug command: does anything float? Game-agnostic: copy this
 * file into any cartwheel 3D game and call grounding_register() in init.
 * tests/grounding.mjs sends the command to the cart under romdev.
 *
 * A "thing" is each child of the scene's root node that is a body or an area
 * (a tree, a crate, a player, a pickup: everything under it is one thing),
 * each mesh under any other child (a plain Node3D holding a model of many
 * pieces, such as the level's dressing: each piece is judged alone, reported
 * as its "instance" number), and each instance of an instanced mesh. Its box is the world bounding box of every visible mesh
 * under it. A thing stands when the bottom of its box
 *   - is within `tol` of the lowest bottom in the level (the ground), or
 *   - touches another thing: some other box overlaps its footprint (by more
 *     than 2 cm each way) and spans its bottom height, within `tol`.
 * Everything else floats. Exempt a thing on purpose (a bird, a cloud, a lamp
 * fixed to a wall) by putting its node in the group "airborne".
 *
 * Reply: {"things":N,"floating":K,"max_gap":metres,"list":[{"path","gap"},...],
 *         "standing":["path",...]}   (`grounding [tol]`, tol default 0.03 m)
 * The test's control lifts one standing thing 0.5 m with the `set` command and
 * this must then report it. */
#include <float.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/debug.h"
#include "cartwheel/scene.h"
#include "cartwheel/scene_file.h"

#define MAX_THINGS 2048

typedef struct { t3_box3 b; cw_node n; int inst; } thing;
static thing T[MAX_THINGS];
static int nt;

static void grow(t3_box3 *b, t3_vec3 p) {
  if (p.x < b->min.x) b->min.x = p.x;
  if (p.y < b->min.y) b->min.y = p.y;
  if (p.z < b->min.z) b->min.z = p.z;
  if (p.x > b->max.x) b->max.x = p.x;
  if (p.y > b->max.y) b->max.y = p.y;
  if (p.z > b->max.z) b->max.z = p.z;
}

/* the 8 corners of a local box through a column-major matrix (three.js layout) */
static void grow_box(t3_box3 *b, const t3_box3 *local, const float *m) {
  for (int i = 0; i < 8; i++) {
    float x = i & 1 ? local->max.x : local->min.x, y = i & 2 ? local->max.y : local->min.y, z = i & 4 ? local->max.z : local->min.z;
    grow(b, (t3_vec3){ m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14] });
  }
}

static void mul(const float *a, const float *b, float *o) {
  for (int c = 0; c < 4; c++)
    for (int r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
}

static bool hidden(const t3_object *o) {
  for (; o; o = o->parent)
    if (!o->visible) return true;
  return false;
}

typedef struct { t3_box3 b; bool any, each; cw_node n; int part; } walk_ctx;

static void visit(t3_object *o, void *user) {
  walk_ctx *w = user;
  if (o->type != T3_MESH && o->type != T3_SKINNED_MESH && o->type != T3_INSTANCED_MESH) return;
  t3_mesh *m = (t3_mesh *)o;
  if (!m->geometry || hidden(o)) return;
  if (!m->geometry->has_bounding_box) t3_geometry_compute_bounding_box(m->geometry);
  if (o->type == T3_INSTANCED_MESH) { /* each instance is a thing of its own */
    t3_instanced_mesh *im = (t3_instanced_mesh *)o;
    const float *mats = im->instance_matrix ? im->instance_matrix->array : NULL;
    for (int i = 0; mats && i < im->count && nt < MAX_THINGS; i++) {
      float world[16];
      mul(o->matrix_world.e, mats + 16 * i, world);
      t3_box3 b = { { FLT_MAX, FLT_MAX, FLT_MAX }, { -FLT_MAX, -FLT_MAX, -FLT_MAX } };
      grow_box(&b, &m->geometry->bounding_box, world);
      T[nt++] = (thing){ b, w->n, i };
    }
    return;
  }
  if (w->each) { /* a piece of a model: a thing of its own */
    t3_box3 b = { { FLT_MAX, FLT_MAX, FLT_MAX }, { -FLT_MAX, -FLT_MAX, -FLT_MAX } };
    grow_box(&b, &m->geometry->bounding_box, o->matrix_world.e);
    if (nt < MAX_THINGS) T[nt++] = (thing){ b, w->n, w->part++ };
    return;
  }
  grow_box(&w->b, &m->geometry->bounding_box, o->matrix_world.e);
  w->any = true;
}

static bool airborne(cw_node n) {
  for (; n.id; n = cw_node_parent(n))
    if (cw_node_in_group(n, "airborne")) return true;
  return false;
}

static void collect(void) {
  nt = 0;
  cw_node root = cw_tree_root(cw_scene_app_tree());
  if (cw_node_child_count(root) == 1) root = cw_node_child(root, 0); /* a scene's own root node (Level) */
  for (int i = 0; i < cw_node_child_count(root) && nt < MAX_THINGS; i++) {
    cw_node c = cw_node_child(root, i);
    t3_object *o = cw_node3d_object(c);
    if (!o || airborne(c)) continue;
    t3_object_update_matrix_world(o, true);
    walk_ctx w = { { { FLT_MAX, FLT_MAX, FLT_MAX }, { -FLT_MAX, -FLT_MAX, -FLT_MAX } }, false,
                   !cw_node_is(c, "CollisionObject3D"), c, 0 };
    t3_object_traverse(o, visit, &w);
    if (w.any && nt < MAX_THINGS) T[nt++] = (thing){ w.b, c, -1 };
  }
}

static float gap_of(int i, float ground, float tol) {
  const t3_box3 *a = &T[i].b;
  float bottom = a->min.y;
  if (bottom <= ground + tol) return 0;
  float best = FLT_MAX;
  const float e = 0.02f;
  for (int j = 0; j < nt; j++) {
    if (j == i || (T[j].n.id == T[i].n.id && T[j].inst == T[i].inst)) continue;
    const t3_box3 *b = &T[j].b;
    if (b->max.x < a->min.x + e || b->min.x > a->max.x - e || b->max.z < a->min.z + e || b->min.z > a->max.z - e) continue;
    if (b->min.y - tol > bottom) continue; /* above it */
    float g = bottom > b->max.y ? bottom - b->max.y : 0; /* resting on it, or reaching into it */
    if (g < best) best = g;
  }
  return best;
}

static void cmd_grounding(int argc, const char **argv, cw_reply *r) {
  float tol = argc > 1 ? (float)atof(argv[1]) : 0.03f;
  collect();
  float ground = FLT_MAX, max_gap = 0;
  for (int i = 0; i < nt; i++) ground = fminf(ground, T[i].b.min.y);
  int floating = 0;
  cw_node root = cw_tree_root(cw_scene_app_tree());
  char path[256];
  cw_reply_printf(r, "{\"things\":%d,\"list\":[", nt);
  for (int i = 0; i < nt; i++) {
    float g = gap_of(i, ground, tol);
    if (g <= tol) continue;
    if (g > max_gap) max_gap = g == FLT_MAX ? 999 : g;
    cw_node_path(T[i].n, root, path, sizeof path);
    cw_reply_printf(r, "%s{\"path\":\"%s\",\"instance\":%d,\"gap\":%.3f}", floating++ ? "," : "", path, T[i].inst, g == FLT_MAX ? 999.0 : (double)g);
  }
  cw_reply_printf(r, "],\"floating\":%d,\"max_gap\":%.3f,\"standing\":[", floating, (double)max_gap);
  int k = 0;
  for (int i = 0; i < nt; i++) {
    if (T[i].inst >= 0 || T[i].b.min.y <= ground + tol || gap_of(i, ground, tol) > tol) continue;
    cw_node_path(T[i].n, root, path, sizeof path);
    cw_reply_printf(r, "%s\"%s\"", k++ ? "," : "", path);
  }
  cw_reply_printf(r, "]}");
}

void grounding_register(void) {
  cw_debug_command("grounding", "grounding [tol]: every thing in the level whose box does not stand on the ground or on another thing (src/grounding.c)", cmd_grounding);
}
