// Checks for the per-lane resume data: lanes.yaml, the optional `lanes` field on bullets, the optional
// `lane_rank` on roles, and combos.yaml. They live here, in plain JavaScript with no Astro imports, so
// the build (src/lib/resume.ts) and the tests (tests/lane-data.spec.ts) run the very same code.
//
// Field shapes (tier 1 to 3, whole numbers) are checked by the schemas in src/content.config.ts. This file
// checks what a single-collection schema cannot: that ids point at things that exist, that a combined
// bullet is only used where every bullet it replaces is also used, and that role ranks are all-or-nothing.

/**
 * @typedef {{ id: string, code: string, role_floor?: Record<string, number> }} Lane
 * @typedef {{ id: string, lane_rank?: Record<string, number> }} Role
 * @typedef {{ id: string, role: string, public: boolean, lanes?: Record<string, number[]> }} Bullet
 * @typedef {{ id: string, role: string, replaces: string[], lanes: string[] }} Combo
 */

/**
 * @param {{ lanes: Lane[], roles: Role[], bullets: Bullet[], combos?: Combo[] }} data plain `data` objects, as written in the YAML
 * @returns {string[]} one readable message per problem; empty when the data is sound
 */
export function checkLaneData({ lanes, roles, bullets, combos = [] }) {
  /** @type {string[]} */
  const problems = [];
  const laneIds = new Set(lanes.map((l) => l.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const bulletsById = new Map(bullets.map((b) => [b.id, b]));

  for (const [key, label] of /** @type {const} */ ([['id', 'id'], ['code', 'code']])) {
    const seen = new Set();
    for (const lane of lanes) {
      if (seen.has(lane[key])) problems.push(`lanes.yaml lists the lane ${label} "${lane[key]}" twice`);
      seen.add(lane[key]);
    }
  }

  for (const lane of lanes) {
    for (const role of Object.keys(lane.role_floor ?? {})) {
      if (!roleIds.has(role)) problems.push(`lane "${lane.id}" sets a role_floor for "${role}", which is not in roles.yaml`);
    }
  }

  for (const bullet of bullets) {
    for (const lane of Object.keys(bullet.lanes ?? {})) {
      if (!laneIds.has(lane)) problems.push(`bullet "${bullet.id}" is tagged for lane "${lane}", which is not in lanes.yaml`);
    }
  }

  // Role ranks are all or nothing: a half-imported set would silently sort some roles wrong.
  const ranked = roles.filter((r) => r.lane_rank);
  for (const role of ranked) {
    for (const lane of Object.keys(role.lane_rank ?? {})) {
      if (!laneIds.has(lane)) problems.push(`role "${role.id}" ranks lane "${lane}", which is not in lanes.yaml`);
    }
  }
  if (ranked.length > 0) {
    for (const role of roles) {
      for (const lane of laneIds) {
        if (role.lane_rank?.[lane] === undefined) problems.push(`role "${role.id}" has no lane_rank for "${lane}" (once any role is ranked, every role needs every lane)`);
      }
    }
  }

  const comboIds = new Set();
  /** @type {Map<string, string>} lane + bullet id -> the combo that already replaces it there */
  const replacedIn = new Map();
  for (const combo of combos) {
    const where = `combo "${combo.id}"`;
    if (comboIds.has(combo.id)) problems.push(`${where} is listed twice`);
    comboIds.add(combo.id);
    if (bulletsById.has(combo.id)) problems.push(`${where} has the same id as a bullet`);
    if (!roleIds.has(combo.role)) problems.push(`${where} uses role "${combo.role}", which is not in roles.yaml`);
    if (combo.replaces.length < 1) problems.push(`${where} replaces no bullets`);
    if (new Set(combo.replaces).size !== combo.replaces.length) problems.push(`${where} lists a replaced bullet twice`);
    if (combo.lanes.length === 0) problems.push(`${where} lists no lanes`);

    for (const id of combo.replaces) {
      const bullet = bulletsById.get(id);
      if (!bullet) {
        problems.push(`${where} replaces "${id}", which is not in bullets.yaml`);
        continue;
      }
      if (!bullet.public) problems.push(`${where} replaces "${id}", which is not public: true`);
      if (bullet.role !== combo.role) problems.push(`${where} is for role "${combo.role}" but replaces "${id}" from role "${bullet.role}"`);
    }
    for (const lane of combo.lanes) {
      if (!laneIds.has(lane)) {
        problems.push(`${where} lists lane "${lane}", which is not in lanes.yaml`);
        continue;
      }
      for (const id of combo.replaces) {
        const bullet = bulletsById.get(id);
        if (bullet && !bullet.lanes?.[lane]) {
          problems.push(`${where} is listed for lane "${lane}", but the bullet it replaces, "${id}", is not tagged for that lane`);
        }
        const key = `${lane}|${id}`;
        const other = replacedIn.get(key);
        if (other) problems.push(`bullet "${id}" is replaced by two combos in lane "${lane}": "${other}" and "${combo.id}"`);
        else replacedIn.set(key, combo.id);
      }
    }
  }

  return problems;
}
