/**
 * TaskFlow — 3D Ofis (admin)
 * Low-poly ofis personajlari (erkak/ayol na'muna) + ish stoli + yurish/o'tirish animatsiyasi.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const MANAGEMENT_LEVELS = new Set(['direktor', 'orinbosar', 'bolim_boshligi']);
const STAY_AT_DESK_LEVELS = new Set(['direktor', 'orinbosar']);

/** 3D ofisdagi ish xonalari (Admin ko'rinmaydi) — yagona kanonik nomlar */
export const OFFICE_WORK_DEPARTMENTS = [
  "Xodimlar bo'limi",
  "Ishga qabul qilish bo'limi",
  "Kompensatsiya bo'limi",
];

/** Na'muna: low-poly humanoid ofis kiyimi (erkak oq + galstuk, ayol pink) */
export const CHARACTER_PRESETS = {
  erkak: {
    headR: 0.13,
    shoulder: 0.2,
    torsoR: 0.15,
    torsoLen: 0.38,
    upperArm: 0.28,
    foreArm: 0.26,
    thigh: 0.42,
    shin: 0.4,
    hair: 'short',
    hairColor: 0x3a2a1c,
    skin: 0xe8c4a8,
    shirt: 0xf5f7fa,
    tie: 0x2f6bb5,
    pants: 0x2a2e36,
    shoes: 0x6b4a32,
    hasTie: true,
  },
  ayol: {
    headR: 0.12,
    shoulder: 0.18,
    torsoR: 0.135,
    torsoLen: 0.36,
    upperArm: 0.26,
    foreArm: 0.24,
    thigh: 0.4,
    shin: 0.38,
    hair: 'ponytail',
    hairColor: 0x2a1f18,
    skin: 0xe8c4a8,
    shirt: 0xf4a4c4, // pink
    tie: null,
    pants: 0x252830,
    shoes: 0x1a1a1a,
    hasTie: false,
  },
};

/** Stol / stul (workstation local). Root polga turadi; o'tirish pose bilan tuziladi. */
const DESK_TOP_Y = 0.72;
const CHAIR_SEAT_Y = 0.40;
/** O'tirganda root pol balandligida qoladi (oyoqlar tegadi) */
const SIT_ROOT_Y = 0;

const WALK_SPEED = 2.6;

function genderOf(u) {
  return u?.gender === 'ayol' ? 'ayol' : 'erkak';
}

function normalizeOfficeDepartment(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'admin' || s === 'админ' || s === 'boshqa') return "Xodimlar bo'limi";
  for (const d of OFFICE_WORK_DEPARTMENTS) {
    if (d.toLowerCase() === s) return d;
  }
  if (s.includes('qabul') || s.includes('hr') || s.includes('recruit')) return "Ishga qabul qilish bo'limi";
  if (s.includes('kompens') || s.includes('payroll') || s.includes('moliya')) return "Kompensatsiya bo'limi";
  if (s.includes('xodim') || s.includes('staff') || s.includes('personnel')) return "Xodimlar bo'limi";
  if (s.includes('boshqaruv') || s.includes('management')) return "Xodimlar bo'limi";
  return "Xodimlar bo'limi";
}

function officeUsers(users) {
  return (users || []).filter((u) => {
    if (!u || u.is_active === false) return false;
    const role = String(u.role || '').toLowerCase();
    if (role === 'admin') return false;
    const dept = String(u.department || '').trim().toLowerCase();
    if (dept === 'admin' || dept === 'админ') return false;
    return true;
  });
}

function hexToInt(hex, fallback = 0x4c8dff) {
  if (!hex) return fallback;
  const h = String(hex).trim().replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return Number.isFinite(n) ? n : fallback;
}

function positionLevelOf(u) {
  const lv = u?.position_level;
  if (lv && (MANAGEMENT_LEVELS.has(lv) || lv === 'xodim')) return lv;
  return (
    { director: 'direktor', deputy_director: 'orinbosar', dept_head: 'bolim_boshligi' }[u?.role] || 'xodim'
  );
}

function positionLabel(level) {
  return {
    direktor: 'Direktor',
    orinbosar: "Direktor o'rinbosari",
    bolim_boshligi: "Bo'lim boshlig'i",
    xodim: 'Xodim',
  }[level] || level;
}

function userWorkStatus(user, tasks) {
  const own = (tasks || []).filter(
    (t) => t.assignee_user_id === user.id || t.assignee === user.display_name
  );
  const overdue = own.filter((t) => {
    if (t.status === 'bajarildi' || t.status === 'tekshiruvda') return false;
    if (!t.deadline) return false;
    return new Date(t.deadline) < new Date();
  });
  const active = own.filter((t) => t.status === 'jarayonda' || t.status === 'tekshiruvda');
  const done = own.filter((t) => t.status === 'bajarildi');
  if (overdue.length) {
    return {
      kind: 'overdue',
      label: '⚠️ ' + (overdue[0].title || '').slice(0, 28),
      title: overdue[0].title || '',
      activeCount: active.length,
      overdueCount: overdue.length,
      doneCount: done.length,
    };
  }
  if (active.length) {
    return {
      kind: 'busy',
      label: (active[0].title || 'Jarayonda').slice(0, 28),
      title: active[0].title || '',
      activeCount: active.length,
      overdueCount: 0,
      doneCount: done.length,
    };
  }
  return {
    kind: 'free',
    label: STAY_AT_DESK_LEVELS.has(positionLevelOf(user)) ? "Bo'sh" : 'Dam olish',
    title: '',
    activeCount: 0,
    overdueCount: 0,
    doneCount: done.length,
  };
}

const MEETING_DURATION_SEC = 18;
const LUNCH_TZ = 'Asia/Tashkent';
const LUNCH_HOUR_START = 13; // 13:00 inclusive
const LUNCH_HOUR_END = 14;   // 14:00 exclusive
const DEPT_DISPLAY_W = 256;
const DEPT_DISPLAY_H = 96;
const KPI_TV_W = 512;
const KPI_TV_H = 288;

function colorCss(hexInt) {
  return '#' + ((hexInt >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

/** Toshkent (Asia/Tashkent) soat/daqiqa */
function getTashkentTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LUNCH_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return {
    hour: Number.isFinite(hour) ? hour : now.getUTCHours() + 5,
    minute: Number.isFinite(minute) ? minute : now.getUTCMinutes(),
  };
}

/** 13:00–14:00 Toshkent — tushlik */
function isLunchBreakNow(now = new Date()) {
  const { hour } = getTashkentTimeParts(now);
  return hour >= LUNCH_HOUR_START && hour < LUNCH_HOUR_END;
}

function tasksOfUser(user, tasks) {
  return (tasks || []).filter(
    (t) =>
      !t.deleted_at &&
      (t.assignee_user_id === user.id || t.assignee === user.display_name)
  );
}

function isTaskOverdue(t, now = new Date()) {
  if (t.status === 'bajarildi' || t.status === 'tekshiruvda') return false;
  if (!t.deadline) return false;
  return new Date(t.deadline) < now;
}

function isTaskDueToday(t, now = new Date()) {
  if (t.status === 'bajarildi') return false;
  if (!t.deadline) return false;
  const d = new Date(t.deadline);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function deptTaskStats(deptName, users, tasks) {
  const members = officeUsers(users).filter(
    (u) => normalizeOfficeDepartment(u.department) === deptName
  );
  let total = 0;
  let done = 0;
  let overdue = 0;
  const now = new Date();
  members.forEach((u) => {
    const own = tasksOfUser(u, tasks);
    total += own.length;
    done += own.filter((t) => t.status === 'bajarildi').length;
    overdue += own.filter((t) => isTaskOverdue(t, now)).length;
  });
  const pct = total ? Math.round((done / total) * 100) : 100;
  const overdueRatio = total ? overdue / total : 0;
  return { total, done, overdue, pct, overdueRatio };
}

function globalTaskStats(tasks) {
  const list = (tasks || []).filter((t) => !t.deleted_at);
  const now = new Date();
  return {
    total: list.length,
    done: list.filter((t) => t.status === 'bajarildi').length,
    progress: list.filter((t) => t.status === 'jarayonda').length,
    overdue: list.filter((t) => isTaskOverdue(t, now)).length,
  };
}

function isBirthdayToday(user) {
  const raw = user?.birth_date;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function monthlyTopPerformerId(users, tasks) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const counts = new Map();
  (tasks || []).forEach((t) => {
    if (t.deleted_at || t.status !== 'bajarildi') return;
    const stamp = t.completed_at || t.updated_at || t.created_at;
    if (!stamp) return;
    const d = new Date(stamp);
    if (d.getFullYear() !== y || d.getMonth() !== m) return;
    const key = t.assignee_user_id || t.assignee;
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let bestId = null;
  let bestN = 0;
  officeUsers(users).forEach((u) => {
    const n = counts.get(u.id) || counts.get(u.display_name) || 0;
    if (n > bestN) {
      bestN = n;
      bestId = u.id;
    }
  });
  return bestN > 0 ? bestId : null;
}

function createCanvasPlane(widthPx, heightPx, planeW, planeH) {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material);
  return { canvas, ctx, tex, material, mesh };
}

function drawDeptDoorDisplay(ctx, stats, colors) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pct = stats.pct;
  let bg = colors.success;
  if (pct < 40) bg = colors.danger;
  else if (pct < 70) bg = colors.warning;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colorCss(bg);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = colorCss(colors.text);
  ctx.font = 'bold 28px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pct + '%', w / 2, h / 2 - 10);
  ctx.font = '14px system-ui,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(stats.done + ' / ' + stats.total + ' bajarildi', w / 2, h / 2 + 22);
}

function drawKpiTvScreen(ctx, stats, colors) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colorCss(colors.panel);
  ctx.fillRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = colorCss(colors.accent);
  ctx.fillRect(12, 12, w - 24, 6);

  const rows = [
    { label: 'JAMI', value: stats.total, color: colors.text },
    { label: 'BAJARILGAN', value: stats.done, color: colors.success },
    { label: 'JARAYONDA', value: stats.progress, color: colors.accent },
    { label: "MUDDATI O'TGAN", value: stats.overdue, color: colors.danger },
  ];
  const cellW = (w - 48) / 2;
  const cellH = (h - 56) / 2;
  rows.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 24 + col * cellW;
    const y = 36 + row * cellH;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(x, y, cellW - 12, cellH - 12);
    ctx.fillStyle = colorCss(r.color);
    ctx.font = 'bold 42px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(r.value), x + 14, y + 18);
    ctx.font = '13px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(r.label, x + 14, y + 70);
  });
}

function syncOverdueBeacon(person, show, colors) {
  let beacon = person.userData.overdueBeacon;
  if (show) {
    if (!beacon) {
      beacon = new THREE.Group();
      beacon.name = 'overdueBeacon';
      const danger = colors?.danger ?? 0xf2635c;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.12, 1.55, 10, 1, true),
        new THREE.MeshStandardMaterial({
          color: danger,
          emissive: danger,
          emissiveIntensity: 1.1,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
          roughness: 0.35,
          metalness: 0.1,
        })
      );
      shaft.position.y = 2.55;
      beacon.add(shaft);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: danger,
          emissiveIntensity: 1.4,
          roughness: 0.2,
        })
      );
      tip.position.y = 3.35;
      beacon.add(tip);
      person.add(beacon);
      person.userData.overdueBeacon = beacon;
    } else {
      beacon.visible = true;
      beacon.traverse((c) => {
        if (c.material?.emissive && colors?.danger != null) {
          c.material.emissive.setHex(colors.danger);
          if (c.material.color && c !== beacon.children[1]) c.material.color.setHex(colors.danger);
        }
      });
    }
  } else if (beacon) {
    beacon.visible = false;
  }
}

function createConfettiGroup() {
  const g = new THREE.Group();
  g.name = 'birthdayConfetti';
  const palette = [0xff5c8a, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xffb703];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.035 + Math.random() * 0.025, 6, 5),
      new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        emissive: palette[i % palette.length],
        emissiveIntensity: 0.35,
        roughness: 0.45,
      })
    );
    s.userData.baseY = 1.85 + Math.random() * 0.35;
    s.userData.phase = Math.random() * Math.PI * 2;
    s.userData.radius = 0.18 + Math.random() * 0.22;
    s.userData.spin = 0.8 + Math.random() * 1.4;
    s.position.set(0, s.userData.baseY, 0);
    g.add(s);
  }
  return g;
}

function animateConfetti(group, t) {
  group.children.forEach((s, i) => {
    const ph = s.userData.phase + t * s.userData.spin;
    const lift = (Math.sin(t * 1.3 + ph) + 1) * 0.12;
    s.position.x = Math.cos(ph) * s.userData.radius;
    s.position.z = Math.sin(ph * 0.9) * s.userData.radius;
    s.position.y = s.userData.baseY + lift + (i % 3) * 0.04;
    s.rotation.y = ph;
    s.rotation.x = ph * 0.5;
  });
}

function createTrophyBadge(colors) {
  const g = new THREE.Group();
  g.name = 'monthTrophy';
  const gold = colors?.warning ?? 0xf2b84b;
  const cup = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    new THREE.MeshStandardMaterial({
      color: gold,
      emissive: gold,
      emissiveIntensity: 0.35,
      metalness: 0.65,
      roughness: 0.28,
    })
  );
  cup.position.y = 2.15;
  g.add(cup);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.16, 8),
    new THREE.MeshStandardMaterial({
      color: gold,
      emissive: gold,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.32,
    })
  );
  cone.position.y = 2.0;
  cone.rotation.x = Math.PI;
  g.add(cone);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.04, 8),
    new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.4, roughness: 0.4 })
  );
  base.position.y = 1.9;
  g.add(base);
  return g;
}

function syncBirthdayAndTrophy(person, user, topId, colors) {
  const showBday = isBirthdayToday(user);
  let confetti = person.userData.confetti;
  if (showBday && !confetti) {
    confetti = createConfettiGroup();
    person.add(confetti);
    person.userData.confetti = confetti;
  } else if (!showBday && confetti) {
    person.remove(confetti);
    disposeObject(confetti);
    person.userData.confetti = null;
  }

  const showTrophy = !!(topId && user.id === topId);
  let trophy = person.userData.trophy;
  if (showTrophy && !trophy) {
    trophy = createTrophyBadge(colors);
    person.add(trophy);
    person.userData.trophy = trophy;
  } else if (!showTrophy && trophy) {
    person.remove(trophy);
    disposeObject(trophy);
    person.userData.trophy = null;
  } else if (showTrophy && trophy && colors?.warning != null) {
    trophy.traverse((c) => {
      if (c.material?.emissive) {
        c.material.emissive.setHex(colors.warning);
        if (c.material.color) c.material.color.setHex(colors.warning);
      }
    });
  }
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
    if (child.element && child.element.parentNode) child.element.parentNode.removeChild(child.element);
  });
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.65,
    metalness: opts.metalness ?? 0.05,
    ...opts,
  });
}

/** Low-poly humanoid — oyoqlar y≈0 da, o'tirishda bel/stul/klaviatura moslashadi */
function createPersonMesh(level, gender) {
  const g = genderOf({ gender });
  const p = CHARACTER_PRESETS[g] || CHARACTER_PRESETS.erkak;
  const root = new THREE.Group();
  root.scale.setScalar(1);

  const skinM = mat(p.skin, { roughness: 0.72 });
  const shirtM = mat(p.shirt, { roughness: 0.55 });
  const pantsM = mat(p.pants, { roughness: 0.7 });
  const hairM = mat(p.hairColor, { roughness: 0.88 });
  const shoeM = mat(p.shoes, { roughness: 0.8 });
  const segs = 6;

  // Bel balandligi (tik) — oyoqlar shundan pastga ~0 gacha
  const HIP_STAND = 0.9;
  const TORSO_STAND = 1.08;
  const ARM_STAND = 1.28;
  const HEAD_STAND = 1.52;

  // —— Bosh guruhi (o'tirishda birga pastga) ——
  const headGroup = new THREE.Group();
  headGroup.position.y = HEAD_STAND;
  root.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(p.headR, 10, 8), skinM);
  headGroup.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, segs), skinM);
  neck.position.y = -0.14;
  headGroup.add(neck);

  if (p.hair === 'ponytail') {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 1.05, 10, 8), hairM);
    hairCap.position.y = 0.04;
    hairCap.scale.set(1.05, 0.75, 1.05);
    headGroup.add(hairCap);
    const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 6), hairM);
    pony.position.set(0, -0.16, -0.14);
    pony.rotation.x = 0.55;
    headGroup.add(pony);
  } else {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 1.08, 10, 8), hairM);
    hairCap.position.y = 0.06;
    hairCap.scale.set(1.02, 0.55, 1.05);
    headGroup.add(hairCap);
  }

  // —— Torso ——
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = TORSO_STAND;
  root.add(torsoGroup);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(p.torsoR, p.torsoLen, 4, segs), shirtM);
  torsoGroup.add(torso);

  if (p.hasTie && p.tie != null) {
    const tie = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.025, 0.22, 3, 5),
      mat(p.tie, { roughness: 0.45 })
    );
    tie.position.set(0, 0.02, p.torsoR + 0.02);
    torsoGroup.add(tie);
  }

  // —— Qo'llar ——
  function makeArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * p.shoulder, ARM_STAND, 0);
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.045, p.upperArm * 0.55, 3, segs),
      shirtM
    );
    upper.position.y = -p.upperArm * 0.35;
    arm.add(upper);
    const forearm = new THREE.Group();
    forearm.position.y = -p.upperArm * 0.7;
    const foreMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.04, p.foreArm * 0.5, 3, segs),
      skinM
    );
    foreMesh.position.y = -p.foreArm * 0.32;
    forearm.add(foreMesh);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), skinM);
    hand.position.y = -p.foreArm * 0.62;
    forearm.add(hand);
    arm.add(forearm);
    root.add(arm);
    return { arm, forearm };
  }
  const left = makeArm(-1);
  const right = makeArm(1);

  // —— Bel / oyoqlar: tufli pastki y≈0.02 ——
  const hip = new THREE.Group();
  hip.position.y = HIP_STAND;
  root.add(hip);

  const pelvis = new THREE.Mesh(
    new THREE.CapsuleGeometry(p.torsoR * 0.95, 0.08, 3, segs),
    pantsM
  );
  pelvis.rotation.z = Math.PI / 2;
  pelvis.position.y = -0.02;
  hip.add(pelvis);

  function makeLeg(side) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.1, -0.02, 0);
    // HIP_STAND(0.9) - 0.02 - 0.48 - 0.38 ≈ 0.02
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 3, segs), pantsM);
    thigh.position.y = -0.24;
    leg.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -0.48;
    const shinMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.26, 3, segs), pantsM);
    shinMesh.position.y = -0.18;
    shin.add(shinMesh);
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.12, 3, 6), shoeM);
    shoe.rotation.z = Math.PI / 2;
    shoe.position.set(0, -0.38, 0.05);
    shin.add(shoe);
    leg.add(shin);
    hip.add(leg);
    return { leg, shin };
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  if (level === 'direktor') {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.1, 5),
      mat(0xf2b84b, { metalness: 0.55, roughness: 0.35 })
    );
    crown.position.y = 0.2;
    headGroup.add(crown);
  } else if (level === 'orinbosar') {
    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06),
      mat(0xc0c8d4, { metalness: 0.65, roughness: 0.3 })
    );
    badge.position.y = 0.18;
    headGroup.add(badge);
  }

  root.userData = {
    ...root.userData,
    shirtM,
    pantsM,
    armL: left.arm,
    armR: right.arm,
    forearmL: left.forearm,
    forearmR: right.forearm,
    legL: legL.leg,
    legR: legR.leg,
    shinL: legL.shin,
    shinR: legR.shin,
    hip,
    head: headGroup,
    torso: torsoGroup,
    hipRestY: HIP_STAND,
    torsoRestY: TORSO_STAND,
    armRestY: ARM_STAND,
    headRestY: HEAD_STAND,
    // O'tirish: bel stulda, yelka stol ustiga yaqin, qo'l klaviaturada
    hipSitY: CHAIR_SEAT_Y - 0.02,
    torsoSitY: 0.55,
    armSitY: 0.78,
    headSitY: 0.98,
    armSitZ: -0.06,
    armShoulderX: p.shoulder,
    baseScale: 1,
    gender: g,
    standY: 0,
  };
  return root;
}

function wantsSunglasses(user) {
  const n = String(user?.display_name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return n.includes('bobur') && n.includes('babajanov');
}

/** Qora ko'zoynak (Bobur Babajanov) */
function addSunglasses(headGroup) {
  const shades = new THREE.Group();
  const dark = mat(0x0d0d0d, { roughness: 0.35, metalness: 0.45 });
  const lens = mat(0x111111, { roughness: 0.2, metalness: 0.55, transparent: true, opacity: 0.92 });

  const left = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.038, 0.022), lens);
  left.position.set(-0.055, 0.012, 0.115);
  shades.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.038, 0.022), lens);
  right.position.set(0.055, 0.012, 0.115);
  shades.add(right);

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.014, 0.018), dark);
  bridge.position.set(0, 0.014, 0.112);
  shades.add(bridge);

  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.016), dark);
  frameTop.position.set(0, 0.032, 0.11);
  shades.add(frameTop);

  const templeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), dark);
  templeL.position.set(-0.11, 0.014, 0.04);
  templeL.rotation.y = 0.35;
  shades.add(templeL);
  const templeR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), dark);
  templeR.position.set(0.11, 0.014, 0.04);
  templeR.rotation.y = -0.35;
  shades.add(templeR);

  headGroup.add(shades);
  return shades;
}

/** Ish stoli: monitor, klaviatura, sichqoncha, stul, o'simlik, krujka */
function createWorkstation(rotY = 0) {
  const g = new THREE.Group();
  g.rotation.y = rotY;

  const wood = mat(0xd4c4a8, { roughness: 0.7 });
  const metal = mat(0x2a2e36, { metalness: 0.4, roughness: 0.45 });
  const black = mat(0x1a1c20, { roughness: 0.5, metalness: 0.2 });
  const screen = mat(0x1e3a5f, { roughness: 0.3, metalness: 0.15, emissive: 0x1a4060, emissiveIntensity: 0.35 });

  // Stol
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.06, 0.7), wood);
  top.position.set(0, 0.72, 0);
  g.add(top);
  [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), metal);
    leg.position.set(x, 0.35, z);
    g.add(leg);
  });
  // Shkaf
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.55), mat(0x6a727c, { roughness: 0.6 }));
  cab.position.set(0.45, 0.3, 0);
  g.add(cab);

  // Monitor
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.08, 8), black);
  stand.position.set(0, 0.78, -0.12);
  g.add(stand);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.04), black);
  neck.position.set(0, 0.92, -0.12);
  g.add(neck);
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.04), black);
  monitor.position.set(0, 1.18, -0.12);
  g.add(monitor);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.02), screen);
  glass.position.set(0, 1.18, -0.095);
  g.add(glass);

  // Klaviatura + sichqoncha
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.18), black);
  kb.position.set(0, 0.77, 0.12);
  g.add(kb);
  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.12), black);
  mouse.position.set(0.38, 0.77, 0.12);
  g.add(mouse);

  // Krujka + o'simlik
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.09, 8), mat(0xf0f0f0));
  mug.position.set(-0.48, 0.8, 0.15);
  g.add(mug);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), mat(0x3a7a4a));
  pot.position.set(0.52, 0.79, -0.18);
  g.add(pot);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), mat(0x4caf50, { roughness: 0.8 }));
  leaf.position.set(0.52, 0.9, -0.18);
  g.add(leaf);

  // Stul (orqada)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), black);
  seat.position.set(0, CHAIR_SEAT_Y, 0.55);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.06), black);
  back.position.set(0, CHAIR_SEAT_Y + 0.3, 0.74);
  g.add(back);
  const chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 8), metal);
  chairBase.position.set(0, 0.08, 0.55);
  g.add(chairBase);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, CHAIR_SEAT_Y - 0.1, 8), metal);
  pole.position.set(0, CHAIR_SEAT_Y / 2, 0.55);
  g.add(pole);

  g.userData.isOfficeProp = true;
  g.userData.sitLocal = new THREE.Vector3(0, 0, 0.55);
  g.userData.deskTopY = DESK_TOP_Y;
  g.userData.chairSeatY = CHAIR_SEAT_Y;
  g.userData.faceYaw = rotY + Math.PI; // stulga o'tirib monitorga qarash
  return g;
}

/** Dam olish: elliptic stol + stolga qaragan stul */
function createRestChair(rotY = 0) {
  const g = new THREE.Group();
  g.rotation.y = rotY;
  const black = mat(0x2a3038, { roughness: 0.55, metalness: 0.15 });
  const metal = mat(0x3a4048, { metalness: 0.45, roughness: 0.5 });
  const fabric = mat(0x3d4a5c, { roughness: 0.85 });

  // Stul: old tomoni +Z (stolga qaragan)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.44), fabric);
  seat.position.set(0, CHAIR_SEAT_Y, 0);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.06), fabric);
  back.position.set(0, CHAIR_SEAT_Y + 0.28, -0.2);
  g.add(back);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 10), metal);
  base.position.set(0, 0.06, 0);
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, CHAIR_SEAT_Y - 0.08, 8), metal);
  pole.position.set(0, CHAIR_SEAT_Y / 2, 0);
  g.add(pole);
  // Qo'ltiqlar
  [-0.22, 0.22].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.32), black);
    arm.position.set(x, CHAIR_SEAT_Y + 0.18, -0.02);
    g.add(arm);
  });

  g.userData.isOfficeProp = true;
  g.userData.sitLocal = new THREE.Vector3(0, 0, 0.18); // stolga yaqinroq
  g.userData.faceYaw = rotY;
  return g;
}

function addRestTableSnacks(g) {
  const y = DESK_TOP_Y + 0.045;
  const plateMat = mat(0xf2f0ea, { roughness: 0.55 });
  const foodWarm = mat(0xd4a05a, { roughness: 0.8 });
  const foodRed = mat(0xc45c48, { roughness: 0.75 });
  const foodGreen = mat(0x5a9a4a, { roughness: 0.8 });
  const drinkCola = mat(0x6b2a1a, { roughness: 0.35, metalness: 0.15 });
  const drinkTea = mat(0xc4a060, { roughness: 0.4 });
  const glass = mat(0xd8e8f0, { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.7 });

  // Markazda meva/salat idishi
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.08, 16), plateMat);
  bowl.position.set(0, y, 0);
  g.add(bowl);
  [[0, 0.06], [0.1, -0.04], [-0.08, -0.05], [0.05, 0.1], [-0.1, 0.06]].forEach(([x, z], i) => {
    const fruit = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + (i % 3) * 0.01, 8, 8),
      i % 2 === 0 ? foodRed : foodGreen
    );
    fruit.position.set(x, y + 0.07, z);
    g.add(fruit);
  });

  // Non / sendvich
  const bread = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.18), foodWarm);
  bread.position.set(-0.7, y + 0.02, 0.15);
  bread.rotation.y = 0.35;
  g.add(bread);
  const filling = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.15), foodGreen);
  filling.position.set(-0.7, y + 0.05, 0.15);
  filling.rotation.y = 0.35;
  g.add(filling);
  const bread2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.18), foodWarm);
  bread2.position.set(-0.7, y + 0.08, 0.15);
  bread2.rotation.y = 0.35;
  g.add(bread2);

  // Pizza / pishiriq
  const pizza = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 16), foodWarm);
  pizza.position.set(0.65, y + 0.015, -0.1);
  g.add(pizza);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), foodRed);
    top.position.set(0.65 + Math.cos(a) * 0.12, y + 0.04, -0.1 + Math.sin(a) * 0.12);
    g.add(top);
  }

  // Ichimliklar
  const drinks = [
    { x: -0.35, z: -0.45, color: drinkCola, h: 0.22, r: 0.045 },
    { x: 0.25, z: -0.5, color: drinkTea, h: 0.16, r: 0.05 },
    { x: 0.55, z: 0.35, color: glass, h: 0.14, r: 0.04 },
    { x: -0.55, z: 0.4, color: drinkCola, h: 0.2, r: 0.04 },
    { x: 0.1, z: 0.5, color: drinkTea, h: 0.15, r: 0.048 },
  ];
  drinks.forEach((d) => {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r * 0.9, d.h, 10), d.color);
    cup.position.set(d.x, y + d.h / 2, d.z);
    g.add(cup);
    if (d.color === drinkCola) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.7, d.r * 0.7, 0.03, 8), mat(0x222222));
      cap.position.set(d.x, y + d.h + 0.01, d.z);
      g.add(cap);
    }
  });

  // Kichik likopchalar (atrofda)
  [[-1.0, 0], [1.0, 0.05], [0, -0.75], [0.2, 0.7]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), plateMat);
    p.position.set(x, y, z);
    g.add(p);
  });
}

function createEllipticRestTable(cx, cz, rx = 2.55, rz = 1.4, opts = {}) {
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  const wood = mat(0xc4a574, { roughness: 0.62 });
  const edge = mat(0x8b6914, { roughness: 0.55, metalness: 0.08 });
  const metal = mat(0x3a3f48, { roughness: 0.5, metalness: 0.25 });

  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.09, 48), wood);
  top.scale.set(rx, 1, rz);
  top.position.y = DESK_TOP_Y;
  g.add(top);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.03, 48), edge);
  rim.scale.set(rx, 1, rz);
  rim.position.y = DESK_TOP_Y - 0.05;
  g.add(rim);

  // 4 ta oyoq — ellipse ichida
  [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]].forEach(([ux, uz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, DESK_TOP_Y - 0.04, 10), metal);
    leg.position.set(ux * rx, (DESK_TOP_Y - 0.04) / 2, uz * rz);
    g.add(leg);
  });

  if (!opts.skipSnacks) addRestTableSnacks(g);

  g.userData.isOfficeProp = true;
  g.userData.rx = rx;
  g.userData.rz = rz;
  return g;
}

function makeLabelEl(user, status, level) {
  const el = document.createElement('div');
  el.className = 'office3d-label';
  el.innerHTML =
    `<div class="name">${escape(user.display_name || '?')}</div>` +
    (MANAGEMENT_LEVELS.has(level)
      ? `<div class="role">${escape(positionLabel(level))}</div>`
      : '') +
    `<div class="status status-${status.kind}">${escape(status.label)}</div>`;
  return el;
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateLabelEl(el, user, status, level) {
  el.innerHTML =
    `<div class="name">${escape(user.display_name || '?')}</div>` +
    (MANAGEMENT_LEVELS.has(level)
      ? `<div class="role">${escape(positionLabel(level))}</div>`
      : '') +
    `<div class="status status-${status.kind}">${escape(status.label)}</div>`;
}

function applyStatusVisual(person, status, colors) {
  person.userData.statusKind = status.kind;
  if (person.userData.labelEl) {
    updateLabelEl(person.userData.labelEl, person.userData.user, status, person.userData.level);
  }
  // Kechikkan — engil qizil glow (kiyim rangini buzmasdan)
  const shirt = person.userData.shirtM;
  if (shirt) {
    if (status.kind === 'overdue') {
      shirt.emissive.setHex(colors?.danger ?? 0xf2635c);
      shirt.emissiveIntensity = 0.25;
    } else {
      shirt.emissive.setHex(0x000000);
      shirt.emissiveIntensity = 0;
    }
  }
  syncOverdueBeacon(person, status.kind === 'overdue', colors);
}

function resetLimbPose(person) {
  const ud = person.userData;
  if (ud.hip && ud.hipRestY != null) ud.hip.position.y = ud.hipRestY;
  if (ud.torso && ud.torsoRestY != null) ud.torso.position.y = ud.torsoRestY;
  if (ud.head && ud.headRestY != null) ud.head.position.y = ud.headRestY;
  const sx = ud.armShoulderX ?? 0.2;
  if (ud.armL) {
    ud.armL.position.set(-sx, ud.armRestY ?? 1.28, 0);
    ud.armL.rotation.set(0, 0, 0.12);
  }
  if (ud.armR) {
    ud.armR.position.set(sx, ud.armRestY ?? 1.28, 0);
    ud.armR.rotation.set(0, 0, -0.12);
  }
  if (ud.forearmL) ud.forearmL.rotation.set(0, 0, 0);
  if (ud.forearmR) ud.forearmR.rotation.set(0, 0, 0);
  if (ud.legL) ud.legL.rotation.set(0, 0, 0);
  if (ud.legR) ud.legR.rotation.set(0, 0, 0);
  if (ud.shinL) ud.shinL.rotation.set(0, 0, 0);
  if (ud.shinR) ud.shinR.rotation.set(0, 0, 0);
  if (ud.hip) ud.hip.rotation.set(0, 0, 0);
  if (ud.torso) ud.torso.rotation.set(0, 0, 0);
  if (ud.head) ud.head.rotation.set(0, 0, 0);
}

function applySitPose(person, t) {
  const ud = person.userData;
  const restSit = ud.zone === 'rest' || ud.zone === 'meeting' || ud.restSit || (ud.target && ud.target.restSit);

  if (ud.hip) {
    ud.hip.position.y = ud.hipSitY ?? CHAIR_SEAT_Y - 0.02;
    ud.hip.rotation.x = restSit ? 0.08 : 0.04;
  }
  if (ud.torso) {
    ud.torso.position.y = ud.torsoSitY ?? 0.55;
    ud.torso.rotation.x = restSit ? 0.14 : 0.12;
  }
  if (ud.head) {
    ud.head.position.y = ud.headSitY ?? 0.98;
    ud.head.rotation.set(restSit ? 0.05 : -0.08, 0, 0);
  }

  const armY = restSit ? 0.74 : (ud.armSitY ?? 0.78);
  const armZ = restSit ? 0.28 : (ud.armSitZ ?? -0.06);
  const sx = ud.armShoulderX ?? 0.2;
  const tap = Math.sin(t * 12) * 0.05;

  if (restSit) {
    // Dam olish: qo'llar stol ustida
    if (ud.armL) {
      ud.armL.position.set(-sx * 0.9, armY, armZ);
      ud.armL.rotation.set(-Math.PI / 2 + 0.05, 0.08, 0.2);
    }
    if (ud.armR) {
      ud.armR.position.set(sx * 0.9, armY, armZ);
      ud.armR.rotation.set(-Math.PI / 2 + 0.05, -0.08, -0.2);
    }
    if (ud.forearmL) ud.forearmL.rotation.set(0.35, 0.04, 0);
    if (ud.forearmR) ud.forearmR.rotation.set(0.35, -0.04, 0);
  } else {
    if (ud.armL) {
      ud.armL.position.set(-sx, armY, armZ);
      ud.armL.rotation.set(-Math.PI / 2 - 0.25, 0.12, 0.18);
    }
    if (ud.armR) {
      ud.armR.position.set(sx, armY, armZ);
      ud.armR.rotation.set(-Math.PI / 2 - 0.25, -0.12, -0.18);
    }
    if (ud.forearmL) ud.forearmL.rotation.set(0.05 + tap, 0.08, 0);
    if (ud.forearmR) ud.forearmR.rotation.set(0.05 - tap, -0.08, 0);
  }

  if (ud.legL) ud.legL.rotation.set(-Math.PI / 2 + 0.1, 0.06, 0);
  if (ud.legR) ud.legR.rotation.set(-Math.PI / 2 + 0.1, -0.06, 0);
  if (ud.shinL) ud.shinL.rotation.x = Math.PI / 2 - 0.06;
  if (ud.shinR) ud.shinR.rotation.x = Math.PI / 2 - 0.06;
}

function applyIdlePose(person, t) {
  resetLimbPose(person);
  const ud = person.userData;
  if (ud.armL) ud.armL.rotation.z = 0.12 + Math.sin(t * 1.2) * 0.03;
  if (ud.armR) ud.armR.rotation.z = -0.12 - Math.sin(t * 1.2 + 0.5) * 0.03;
  if (ud.head) ud.head.rotation.y = Math.sin(t * 0.7) * 0.08;
}

function applyWalkPose(person, t) {
  resetLimbPose(person);
  const ud = person.userData;
  const swing = Math.sin(t * 8) * 0.55;
  if (ud.legL) ud.legL.rotation.x = swing;
  if (ud.legR) ud.legR.rotation.x = -swing;
  if (ud.shinL) ud.shinL.rotation.x = Math.max(0, -swing) * 0.4;
  if (ud.shinR) ud.shinR.rotation.x = Math.max(0, swing) * 0.4;
  if (ud.armL) ud.armL.rotation.x = -swing * 0.7;
  if (ud.armR) ud.armR.rotation.x = swing * 0.7;
  if (ud.forearmL) ud.forearmL.rotation.x = 0.2;
  if (ud.forearmR) ud.forearmR.rotation.x = 0.2;
  if (ud.torso) ud.torso.rotation.x = 0.05;
}

export const Office3D = {
  _state: null,

  isOpen() {
    return !!this._state;
  },

  open(container, opts = {}) {
    this.close();
    const colors = this._readColors(opts.getThemeColors);
    const root = container;
    root.innerHTML = '';
    root.classList.add('office3d-active');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.bg);
    scene.fog = new THREE.Fog(colors.bg, 28, 55);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    camera.position.set(0, 14, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    root.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.inset = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    root.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 42;
    controls.target.set(0, 1, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.95);
    dir.position.set(8, 16, 6);
    dir.castShadow = true;
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const tooltip = document.createElement('div');
    tooltip.className = 'office3d-tooltip hidden';
    root.appendChild(tooltip);

    const st = {
      root,
      scene,
      camera,
      renderer,
      labelRenderer,
      controls,
      colors,
      people: new Map(),
      clickables: [],
      deskSlots: {},
      restSlots: [],
      restAssign: new Map(),
      workstations: [],
      deptFloors: new Map(),
      deptDisplays: new Map(),
      meetingSlots: [],
      meeting: null,
      meetingCycleDone: false,
      lunchActive: false,
      lunchAssign: new Map(),
      kpiTv: null,
      cachedUsers: opts.users || [],
      cachedTasks: opts.tasks || [],
      layoutKey: '',
      raf: 0,
      running: true,
      hovered: null,
      tooltip,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      clock: new THREE.Clock(),
      onSelectUser: opts.onSelectUser || (() => {}),
      getThemeColors: opts.getThemeColors,
      onResize: null,
      onVis: null,
      onClick: null,
      onMove: null,
      lastDt: 0,
    };
    this._state = st;

    this._buildWorld(opts.users || [], opts.tasks || []);
    this._bindEvents();
    this._resize();
    this._loop();
    try {
      console.info('[Office3D] build 20260724b — lunch, overlays, network-first cache');
    } catch (_) {}
  },

  update(users, tasks) {
    if (!this._state) return;
    this._state.cachedUsers = users || [];
    this._state.cachedTasks = tasks || [];
    const key = this._layoutKey(users || []);
    if (key !== this._state.layoutKey) {
      this._buildWorld(users || [], tasks || []);
    } else {
      this._updatePeopleStates(users || [], tasks || []);
      this._refreshCreativeOverlays(users || [], tasks || []);
    }
  },

  applyTheme() {
    if (!this._state) return;
    this._state.colors = this._readColors(this._state.getThemeColors);
    this._state.scene.background.setHex(this._state.colors.bg);
    if (this._state.scene.fog) this._state.scene.fog.color.setHex(this._state.colors.bg);
    this._state.people.forEach((p) => {
      applyStatusVisual(p, p.userData.lastStatus || { kind: 'free', label: 'Dam olish' }, this._state.colors);
      syncBirthdayAndTrophy(
        p,
        p.userData.user,
        this._state.topPerformerId,
        this._state.colors
      );
    });
    this._refreshCreativeOverlays(this._state.cachedUsers, this._state.cachedTasks);
  },

  close() {
    const st = this._state;
    if (!st) return;
    st.running = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    window.removeEventListener('resize', st.onResize);
    document.removeEventListener('visibilitychange', st.onVis);
    if (st.onClick) st.renderer.domElement.removeEventListener('pointerdown', st.onClick);
    if (st.onMove) st.renderer.domElement.removeEventListener('pointermove', st.onMove);

    st.people.forEach((p) => {
      st.scene.remove(p);
      disposeObject(p);
    });
    st.people.clear();
    while (st.scene.children.length) {
      const c = st.scene.children[0];
      st.scene.remove(c);
      disposeObject(c);
    }
    st.controls.dispose();
    st.renderer.dispose();
    if (st.renderer.domElement.parentNode) st.renderer.domElement.parentNode.removeChild(st.renderer.domElement);
    if (st.labelRenderer.domElement.parentNode) {
      st.labelRenderer.domElement.parentNode.removeChild(st.labelRenderer.domElement);
    }
    st.root.innerHTML = '';
    st.root.classList.remove('office3d-active');
    this._state = null;
  },

  _readColors(getter) {
    const c = (getter && getter()) || {};
    return {
      bg: hexToInt(c.bg, 0x0b0f17),
      panel: hexToInt(c.panel, 0x121826),
      border: hexToInt(c.border, 0x232c3d),
      accent: hexToInt(c.accent, 0x4c8dff),
      accent2: hexToInt(c.accent2, 0x9b6bea),
      success: hexToInt(c.success, 0x35c77a),
      danger: hexToInt(c.danger, 0xf2635c),
      warning: hexToInt(c.warning, 0xf2b84b),
      text: hexToInt(c.text, 0xe7ecf3),
    };
  },

  _layoutKey(users) {
    return officeUsers(users)
      .map(
        (u) =>
          `${u.id}|${normalizeOfficeDepartment(u.department)}|${positionLevelOf(u)}|${genderOf(u)}|${u.display_name || ''}`
      )
      .sort()
      .join(';');
  },

  _clearPeopleAndRooms() {
    const st = this._state;
    st.people.forEach((p) => {
      st.scene.remove(p);
      disposeObject(p);
    });
    st.people.clear();
    st.clickables = [];
    st.deskSlots = {};
    st.restSlots = [];
    st.restAssign = new Map();
    st.workstations = [];
    st.deptFloors = new Map();
    st.deptDisplays = new Map();
    st.meetingSlots = [];
    st.meeting = null;
    st.lunchActive = false;
    st.lunchAssign = new Map();
    st.kpiTv = null;
    const toRemove = st.scene.children.filter((c) => c.userData && c.userData.isOfficeProp);
    toRemove.forEach((c) => {
      st.scene.remove(c);
      disposeObject(c);
    });
  },

  _floor(w, d, y, color, x = 0, z = 0) {
    const st = this._state;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.08, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    );
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.userData.isOfficeProp = true;
    mesh.userData.baseFloorColor = color;
    st.scene.add(mesh);
    return mesh;
  },

  _wall(w, h, d, x, y, z, color) {
    const st = this._state;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: true, opacity: 0.55 })
    );
    mesh.position.set(x, y, z);
    mesh.userData.isOfficeProp = true;
    st.scene.add(mesh);
    return mesh;
  },

  _roomLabel(text, x, z) {
    const st = this._state;
    const el = document.createElement('div');
    el.className = 'office3d-room-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, 2.6, z);
    obj.userData.isOfficeProp = true;
    st.scene.add(obj);
  },

  _makeRoom(cx, cz, w, d, label, floorColor, deptName = null) {
    const st = this._state;
    const colors = st.colors;
    const floor = this._floor(w, d, 0.02, floorColor, cx, cz);
    this._wall(w, 1.2, 0.12, cx, 0.65, cz - d / 2, colors.border);
    this._wall(0.12, 1.2, d, cx - w / 2, 0.65, cz, colors.border);
    this._wall(0.12, 1.2, d, cx + w / 2, 0.65, cz, colors.border);
    this._roomLabel(label, cx, cz - d / 2 + 0.4);

    if (deptName) {
      floor.userData.deptName = deptName;
      st.deptFloors.set(deptName, floor);
      const panel = createCanvasPlane(DEPT_DISPLAY_W, DEPT_DISPLAY_H, 1.7, 0.64);
      drawDeptDoorDisplay(panel.ctx, { pct: 100, done: 0, total: 0 }, colors);
      panel.tex.needsUpdate = true;
      const bezel = new THREE.Mesh(
        new THREE.BoxGeometry(1.85, 0.78, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.55, metalness: 0.2 })
      );
      const group = new THREE.Group();
      group.userData.isOfficeProp = true;
      group.position.set(cx, 1.55, cz - d / 2 + 0.08);
      bezel.position.z = -0.02;
      panel.mesh.position.z = 0.045;
      group.add(bezel);
      group.add(panel.mesh);
      st.scene.add(group);
      st.deptDisplays.set(deptName, { group, ...panel });
    }
  },

  _addWorkstationAt(x, z, rotY, platformY = 0) {
    const st = this._state;
    const ws = createWorkstation(rotY);
    ws.position.set(x, platformY, z);
    st.scene.add(ws);
    st.workstations.push(ws);
    const sit = ws.userData.sitLocal.clone();
    sit.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    // Pol usti — tik va o'tirganda root shu yerda (oyoqlar tegadi)
    const floorY = platformY + 0.04;
    return {
      x: x + sit.x,
      y: floorY,
      z: z + sit.z,
      rotY: ws.userData.faceYaw,
      standY: floorY,
      deskTopWorldY: platformY + DESK_TOP_Y,
      zone: 'work',
    };
  },

  /** Bo'sh / band joylashuv */
  _targetPose(user, status) {
    const st = this._state;
    const level = positionLevelOf(user);
    const isWorking = status.kind === 'busy' || status.kind === 'overdue';

    // Direktor / o'rinbosar — har doim Boshqaruvda o'tiradi
    if (STAY_AT_DESK_LEVELS.has(level)) {
      const desk = st.deskSlots.boshqaruv || {};
      const seats = desk.seats || [];
      const i = Math.max(0, (desk.managers || []).indexOf(user.id));
      const seat = seats[i] || seats[0] || { x: 0, y: 0.42, z: -8, rotY: 0, standY: 0.35, zone: 'work' };
      return {
        ...seat,
        seated: true,
        zone: 'work',
        labelFree: true,
      };
    }

    if (!isWorking) {
      let idx = st.restAssign.get(user.id);
      if (idx == null) {
        const used = new Set(st.restAssign.values());
        idx = 0;
        while (used.has(idx) && idx < st.restSlots.length) idx += 1;
        if (idx >= st.restSlots.length) idx = Math.max(0, st.restSlots.length - 1);
        st.restAssign.set(user.id, idx);
      }
      const slot = st.restSlots[idx] || {
        x: 0, y: 0.04, z: 10, rotY: 0, seated: true, restSit: true,
      };
      return { ...slot, seated: true, restSit: true, zone: 'rest' };
    }

    st.restAssign.delete(user.id);

    const dept = normalizeOfficeDepartment(user.department);
    const room = st.deskSlots[dept];
    if (!room) return { x: 0, y: 0.42, z: 2, rotY: Math.PI, seated: true, zone: 'work' };

    if (level === 'bolim_boshligi' && room.headSeat && room.headId === user.id) {
      return { ...room.headSeat, seated: true, zone: 'work' };
    }

    const members = room.memberIds || [];
    let mi = members.indexOf(user.id);
    if (mi < 0) mi = 0;
    const seat = (room.memberSeats && room.memberSeats[mi]) || room.memberSeats?.[0];
    if (seat) return { ...seat, seated: true, zone: 'work' };
    return { x: room.cx, y: 0.42, z: room.cz, rotY: Math.PI, seated: true, zone: 'work' };
  },

  _buildWorld(users, tasks) {
    const st = this._state;
    this._clearPeopleAndRooms();
    const team = officeUsers(users);
    st.layoutKey = this._layoutKey(users);
    st.cachedUsers = users || [];
    st.cachedTasks = tasks || [];
    st.meetingCycleDone = false;
    const colors = st.colors;

    this._floor(42, 42, 0, colors.panel, 0, 0);

    // —— Boshqaruv (platforma) ——
    const platformY = 0.35;
    this._floor(14, 5, platformY, colors.border, 0, -8);
    this._roomLabel('Boshqaruv', 0, -8);

    const managers = team
      .filter((u) => {
        const lv = positionLevelOf(u);
        return lv === 'direktor' || lv === 'orinbosar';
      })
      .sort((a, b) => positionLevelOf(a).localeCompare(positionLevelOf(b)));

    const mgrSeats = [];
    managers.forEach((u, i) => {
      const n = managers.length;
      const x = (i - (n - 1) / 2) * 3.2;
      mgrSeats.push(this._addWorkstationAt(x, -8.15, 0, platformY));
    });
    st.deskSlots.boshqaruv = { managers: managers.map((u) => u.id), seats: mgrSeats };

    // —— 3 ish bo'limi ——
    const roomW = 9;
    const roomD = 8;
    const workRooms = [
      { name: "Xodimlar bo'limi", cx: -10, cz: 2.5, floor: 0x1a2233 },
      { name: "Ishga qabul qilish bo'limi", cx: 0, cz: 2.5, floor: 0x162030 },
      { name: "Kompensatsiya bo'limi", cx: 10, cz: 2.5, floor: 0x1a2233 },
    ];
    workRooms.forEach((r) => {
      this._makeRoom(r.cx, r.cz, roomW, roomD, r.name, r.floor, r.name);
    });

    // —— Dam olish: elliptic stol + stullar (stolga qaragan) ——
    const restW = 16;
    const restD = 7.2;
    const restCx = 0;
    const restCz = 12;
    this._makeRoom(restCx, restCz, restW, restD, 'Dam olish', 0x1e2838);

    const tableRx = 2.6;
    const tableRz = 1.35;
    const table = createEllipticRestTable(restCx, restCz, tableRx, tableRz);
    st.scene.add(table);

    st.restSlots = [];
    const seatCount = 12;
    // Stullar stol chetiga yaqin — qo'llar stolga tegadi
    const seatRx = tableRx + 0.48;
    const seatRz = tableRz + 0.42;
    for (let i = 0; i < seatCount; i++) {
      const a = (i / seatCount) * Math.PI * 2 + Math.PI / seatCount;
      const sx = restCx + Math.cos(a) * seatRx;
      const sz = restCz + Math.sin(a) * seatRz;
      // Stol markaziga qarash (person forward = +Z)
      const faceYaw = Math.atan2(restCx - sx, restCz - sz);
      const chair = createRestChair(faceYaw);
      chair.position.set(sx, 0, sz);
      st.scene.add(chair);

      const sit = chair.userData.sitLocal.clone();
      sit.applyAxisAngle(new THREE.Vector3(0, 1, 0), faceYaw);
      st.restSlots.push({
        x: sx + sit.x,
        y: 0.04,
        z: sz + sit.z,
        rotY: faceYaw,
        seated: true,
        zone: 'rest',
        restSit: true,
      });
    }

    // —— Kunlik operativka (kichik konferensiya stoli) ——
    const meetCx = restCx + 5.8;
    const meetCz = restCz - 0.2;
    const meetRx = 1.35;
    const meetRz = 0.85;
    const meetTable = createEllipticRestTable(meetCx, meetCz, meetRx, meetRz, { skipSnacks: true });
    st.scene.add(meetTable);
    this._roomLabel('Operativka', meetCx, meetCz - 1.6);
    st.meetingSlots = [];
    const meetSeats = 8;
    const meetSeatRx = meetRx + 0.42;
    const meetSeatRz = meetRz + 0.38;
    for (let i = 0; i < meetSeats; i++) {
      const a = (i / meetSeats) * Math.PI * 2 + Math.PI / meetSeats;
      const sx = meetCx + Math.cos(a) * meetSeatRx;
      const sz = meetCz + Math.sin(a) * meetSeatRz;
      const faceYaw = Math.atan2(meetCx - sx, meetCz - sz);
      const chair = createRestChair(faceYaw);
      chair.position.set(sx, 0, sz);
      st.scene.add(chair);
      const sit = chair.userData.sitLocal.clone();
      sit.applyAxisAngle(new THREE.Vector3(0, 1, 0), faceYaw);
      st.meetingSlots.push({
        x: sx + sit.x,
        y: 0.04,
        z: sz + sit.z,
        rotY: faceYaw,
        seated: true,
        restSit: true,
        zone: 'meeting',
      });
    }

    // —— Devordagi KPI TV ——
    this._createKpiTv();

    OFFICE_WORK_DEPARTMENTS.forEach((deptName, idx) => {
      const r = workRooms[idx];
      const inDept = team.filter(
        (u) =>
          normalizeOfficeDepartment(u.department) === deptName &&
          !STAY_AT_DESK_LEVELS.has(positionLevelOf(u))
      );
      const head = inDept.find((u) => positionLevelOf(u) === 'bolim_boshligi') || null;
      const members = inDept.filter((u) => !head || u.id !== head.id);

      let headSeat = null;
      // Bo'lim boshlig'i stoli (oldinda)
      headSeat = this._addWorkstationAt(r.cx, r.cz - roomD / 2 + 1.6, 0, 0);

      const memberSeats = [];
      const maxPerRow = 3;
      const capacity = Math.max(members.length, 3);
      for (let i = 0; i < capacity; i++) {
        const row = Math.floor(i / maxPerRow);
        const col = i % maxPerRow;
        const mx = r.cx - 2.4 + col * 2.4;
        const mz = r.cz + 0.3 + row * 2.4;
        memberSeats.push(this._addWorkstationAt(mx, mz, Math.PI, 0));
      }

      st.deskSlots[deptName] = {
        cx: r.cx,
        cz: r.cz,
        w: roomW,
        d: roomD,
        headId: head?.id || null,
        headSeat,
        memberIds: members.map((u) => u.id),
        memberSeats,
      };
    });

    st.topPerformerId = monthlyTopPerformerId(users, tasks);

    team.forEach((u) => {
      const status = userWorkStatus(u, tasks);
      const pose = this._resolvePose(u, status);
      this._placePerson(u, pose, tasks);
    });

    this._refreshCreativeOverlays(users, tasks);
    st.lunchActive = isLunchBreakNow();
    st.lunchAssign = new Map();
    if (st.lunchActive) {
      // Tushlik paytida joylarni qayta hisoblash (rahbarlar ham)
      team.forEach((u) => {
        const person = st.people.get(u.id);
        if (!person) return;
        const pose = this._lunchRestPose(u);
        this._setWalkTarget(person, pose);
      });
    } else {
      this._startDailyMeeting(users, tasks);
    }
  },

  _resolvePose(user, status) {
    const st = this._state;
    // Tushlik (13:00–14:00 Toshkent) — hammasi dam olish xonasida
    if (isLunchBreakNow()) {
      return this._lunchRestPose(user);
    }
    if (st.meeting?.active && st.meeting.participantIds.has(user.id)) {
      const slot = st.meeting.slotsByUser.get(user.id);
      if (slot) return { ...slot, seated: true, restSit: true, zone: 'meeting' };
    }
    return this._targetPose(user, status);
  },

  /** Tushlik: barcha (rahbarlar ham) dam olish stollariga */
  _lunchRestPose(user) {
    const st = this._state;
    if (!st.lunchAssign) st.lunchAssign = new Map();
    let idx = st.lunchAssign.get(user.id);
    if (idx == null) {
      idx = st.lunchAssign.size;
      st.lunchAssign.set(user.id, idx);
    }
    const slots = st.restSlots || [];
    if (idx < slots.length) {
      return { ...slots[idx], seated: true, restSit: true, zone: 'rest', lunch: true };
    }
    // Stul yetmasa — stol atrofida turish
    const a = ((idx - slots.length) / Math.max(6, idx - slots.length + 1)) * Math.PI * 2;
    const cx = 0;
    const cz = 12;
    const r = 3.9;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    return {
      x,
      y: 0.04,
      z,
      rotY: Math.atan2(cx - x, cz - z),
      seated: false,
      restSit: false,
      zone: 'rest',
      lunch: true,
    };
  },

  _syncLunchBreak() {
    const st = this._state;
    if (!st) return;
    const lunch = isLunchBreakNow();
    if (lunch === !!st.lunchActive) return;
    st.lunchActive = lunch;
    st.lunchAssign = new Map();
    if (lunch && st.meeting?.active) {
      st.meeting.active = false;
    }
    this._updatePeopleStates(st.cachedUsers || [], st.cachedTasks || []);
  },

  _placePerson(user, pose, tasks) {
    const st = this._state;
    const level = positionLevelOf(user);
    const g = genderOf(user);
    const status = userWorkStatus(user, tasks);
    const person = createPersonMesh(level, g);
    if (wantsSunglasses(user) && person.userData.head) {
      addSunglasses(person.userData.head);
    }
    person.position.set(pose.x, pose.y ?? 0, pose.z);
    person.rotation.y = pose.rotY || 0;
    person.userData.baseY = pose.y ?? 0;
    person.userData.userId = user.id;
    person.userData.user = user;
    person.userData.level = level;
    person.userData.gender = g;
    person.userData.lastStatus = status;
    person.userData.zone = pose.zone;
    person.userData.restSit = !!pose.restSit;
    person.userData.seated = !!pose.seated;
    person.userData.target = {
      x: pose.x,
      y: pose.y ?? 0,
      z: pose.z,
      rotY: pose.rotY || 0,
      seated: !!pose.seated,
      restSit: !!pose.restSit,
    };
    person.userData.walking = false;
    person.castShadow = true;

    const labelEl = makeLabelEl(user, status, level);
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 1.95, 0);
    person.add(label);
    person.userData.labelEl = labelEl;

    applyStatusVisual(person, status, st.colors);
    syncBirthdayAndTrophy(person, user, st.topPerformerId, st.colors);
    resetLimbPose(person);
    st.scene.add(person);
    st.people.set(user.id, person);
    st.clickables.push(person);
  },

  _setWalkTarget(person, pose) {
    const tx = pose.x;
    const ty = pose.y ?? 0;
    const tz = pose.z;
    const cur = person.position;
    const dist = Math.hypot(tx - cur.x, tz - cur.z);
    person.userData.target = {
      x: tx,
      y: ty,
      z: tz,
      rotY: pose.rotY || 0,
      seated: !!pose.seated,
      restSit: !!pose.restSit,
    };
    person.userData.zone = pose.zone;
    person.userData.restSit = !!pose.restSit;
    if (dist > 0.12) {
      person.userData.walking = true;
      person.userData.seated = false;
      // Yo'nalish
      person.rotation.y = Math.atan2(tx - cur.x, tz - cur.z);
    } else {
      person.userData.walking = false;
      person.position.set(tx, ty, tz);
      person.rotation.y = pose.rotY || 0;
      person.userData.seated = !!pose.seated;
      person.userData.baseY = ty;
    }
  },

  _updatePeopleStates(users, tasks) {
    const st = this._state;
    const team = officeUsers(users);
    const seen = new Set();
    st.topPerformerId = monthlyTopPerformerId(users, tasks);

    team.forEach((u) => {
      seen.add(u.id);
      let person = st.people.get(u.id);
      const status = userWorkStatus(u, tasks);
      const pose = this._resolvePose(u, status);

      if (!person) {
        this._placePerson(u, pose, tasks);
        return;
      }

      if (person.userData.gender !== genderOf(u) || person.userData.level !== positionLevelOf(u)) {
        st.scene.remove(person);
        disposeObject(person);
        st.people.delete(u.id);
        st.clickables = st.clickables.filter((c) => c !== person);
        this._placePerson(u, pose, tasks);
        return;
      }

      person.userData.user = u;
      person.userData.lastStatus = status;
      applyStatusVisual(person, status, st.colors);
      syncBirthdayAndTrophy(person, u, st.topPerformerId, st.colors);
      this._setWalkTarget(person, pose);
    });

    [...st.people.keys()].forEach((id) => {
      if (seen.has(id)) return;
      const p = st.people.get(id);
      st.scene.remove(p);
      disposeObject(p);
      st.people.delete(id);
      st.clickables = st.clickables.filter((c) => c !== p);
      st.restAssign.delete(id);
    });
  },

  _createKpiTv() {
    const st = this._state;
    const colors = st.colors;
    const panel = createCanvasPlane(KPI_TV_W, KPI_TV_H, 3.9, 2.15);
    drawKpiTvScreen(panel.ctx, globalTaskStats(st.cachedTasks), colors);
    panel.tex.needsUpdate = true;

    const group = new THREE.Group();
    group.userData.isOfficeProp = true;
    group.position.set(0, 2.35, -5.35);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(4.35, 2.55, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.45, metalness: 0.35 })
    );
    frame.position.z = -0.02;
    group.add(frame);

    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.9, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6, metalness: 0.25 })
    );
    stand.position.set(0, -1.55, -0.05);
    group.add(stand);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.55, metalness: 0.2 })
    );
    base.position.set(0, -2.02, 0);
    group.add(base);

    panel.mesh.position.z = 0.09;
    group.add(panel.mesh);
    st.scene.add(group);
    st.kpiTv = { group, ...panel };
  },

  _refreshCreativeOverlays(users, tasks) {
    const st = this._state;
    if (!st) return;
    const colors = st.colors;

    OFFICE_WORK_DEPARTMENTS.forEach((deptName) => {
      const stats = deptTaskStats(deptName, users, tasks);
      const display = st.deptDisplays.get(deptName);
      if (display) {
        drawDeptDoorDisplay(display.ctx, stats, colors);
        display.tex.needsUpdate = true;
      }
      const floor = st.deptFloors.get(deptName);
      if (floor?.material?.color) {
        const base = new THREE.Color(floor.userData.baseFloorColor ?? 0x1a2233);
        const amount = Math.min(0.55, stats.overdueRatio * 0.9 + (stats.overdueRatio === 0 ? 0.12 : 0));
        // sog'liq yaxshi → yashil nozik; kechikish ko'p → qizil
        const mixToward = stats.overdueRatio > 0.15 ? colors.danger : colors.success;
        const mixed = base.clone().lerp(new THREE.Color(mixToward), Math.max(0.08, amount * 0.65));
        floor.material.color.copy(mixed);
      }
    });

    if (st.kpiTv) {
      drawKpiTvScreen(st.kpiTv.ctx, globalTaskStats(tasks), colors);
      st.kpiTv.tex.needsUpdate = true;
    }
  },

  _startDailyMeeting(users, tasks) {
    const st = this._state;
    if (!st || st.meetingCycleDone) return;
    if (isLunchBreakNow()) return; // tushlik ustuvor
    st.meetingCycleDone = true;

    const now = new Date();
    const participants = officeUsers(users).filter((u) =>
      tasksOfUser(u, tasks).some((t) => isTaskDueToday(t, now))
    );
    if (!participants.length || !st.meetingSlots.length) {
      st.meeting = null;
      return;
    }

    const slotsByUser = new Map();
    const participantIds = new Set();
    participants.forEach((u, i) => {
      const slot = st.meetingSlots[i % st.meetingSlots.length];
      slotsByUser.set(u.id, { ...slot });
      participantIds.add(u.id);
    });

    st.meeting = {
      active: true,
      endsAt: st.clock.elapsedTime + MEETING_DURATION_SEC,
      participantIds,
      slotsByUser,
    };

    participants.forEach((u) => {
      const person = st.people.get(u.id);
      const slot = slotsByUser.get(u.id);
      if (person && slot) {
        this._setWalkTarget(person, { ...slot, seated: true, restSit: true, zone: 'meeting' });
      }
    });
  },

  _endDailyMeeting() {
    const st = this._state;
    if (!st?.meeting?.active) return;
    st.meeting.active = false;
    this._updatePeopleStates(st.cachedUsers || [], st.cachedTasks || []);
  },

  _bindEvents() {
    const st = this._state;
    st.onResize = () => this._resize();
    st.onVis = () => {
      st.running = document.visibilityState !== 'hidden';
      if (st.running) this._loop();
    };
    st.onMove = (e) => this._onPointerMove(e);
    st.onClick = (e) => this._onPointerClick(e);
    window.addEventListener('resize', st.onResize);
    document.addEventListener('visibilitychange', st.onVis);
    st.renderer.domElement.addEventListener('pointermove', st.onMove);
    st.renderer.domElement.addEventListener('pointerdown', st.onClick);
  },

  _resize() {
    const st = this._state;
    if (!st) return;
    const w = st.root.clientWidth || window.innerWidth;
    const h = st.root.clientHeight || window.innerHeight;
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
    st.renderer.setSize(w, h, false);
    st.labelRenderer.setSize(w, h);
  },

  _pick(event) {
    const st = this._state;
    const rect = st.renderer.domElement.getBoundingClientRect();
    st.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    st.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    st.raycaster.setFromCamera(st.pointer, st.camera);
    const hits = st.raycaster.intersectObjects(st.clickables, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.userId) obj = obj.parent;
    return obj || null;
  },

  _onPointerMove(event) {
    const st = this._state;
    if (!st) return;
    const person = this._pick(event);
    if (st.hovered && st.hovered !== person) {
      const s = st.hovered.userData.baseScale || 1;
      st.hovered.scale.setScalar(s);
    }
    st.hovered = person;
    if (person) {
      st.renderer.domElement.style.cursor = 'pointer';
      person.scale.setScalar((person.userData.baseScale || 1) * 1.08);
      const u = person.userData.user;
      const stt = person.userData.lastStatus || {};
      st.tooltip.classList.remove('hidden');
      st.tooltip.style.left = event.clientX - st.root.getBoundingClientRect().left + 14 + 'px';
      st.tooltip.style.top = event.clientY - st.root.getBoundingClientRect().top + 14 + 'px';
      st.tooltip.innerHTML =
        `<b>${escape(u.display_name)}</b><br>` +
        `${escape(positionLabel(person.userData.level))}` +
        (u.department ? ` · ${escape(u.department)}` : '') +
        `<br>Faol: ${stt.activeCount || 0} · Kechikkan: ${stt.overdueCount || 0} · Bajarilgan: ${stt.doneCount || 0}` +
        `<br><i>Bosib topshiriq yaratish</i>`;
    } else {
      st.renderer.domElement.style.cursor = 'default';
      st.tooltip.classList.add('hidden');
    }
  },

  _onPointerClick(event) {
    const st = this._state;
    if (!st || event.button !== 0) return;
    const person = this._pick(event);
    if (person && person.userData.userId) {
      st.onSelectUser(person.userData.userId, person.userData.user);
    }
  },

  _loop() {
    const st = this._state;
    if (!st || !st.running) return;
    st.raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(st.clock.getDelta(), 0.05);
    const t = st.clock.elapsedTime;

    if (st.meeting?.active && t >= st.meeting.endsAt) {
      this._endDailyMeeting();
    }
    // Har ~2 soniyada tushlik oynasini tekshirish (13:00–14:00 Toshkent)
    if ((st._lunchCheckAt || 0) <= t) {
      st._lunchCheckAt = t + 2;
      this._syncLunchBreak();
    }

    st.people.forEach((p) => {
      const tgt = p.userData.target;
      if (p.userData.walking && tgt) {
        const dx = tgt.x - p.position.x;
        const dz = tgt.z - p.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.08) {
          p.position.x = tgt.x;
          p.position.z = tgt.z;
          p.position.y = tgt.y;
          p.rotation.y = tgt.rotY;
          p.userData.walking = false;
          p.userData.seated = !!tgt.seated;
          p.userData.baseY = tgt.y;
        } else {
          const step = WALK_SPEED * dt;
          const ratio = Math.min(1, step / dist);
          p.position.x += dx * ratio;
          p.position.z += dz * ratio;
          p.position.y = THREE.MathUtils.lerp(p.position.y, tgt.y, 0.15);
          p.rotation.y = Math.atan2(dx, dz);
          applyWalkPose(p, t);
        }
      } else if (p.userData.seated || (tgt && tgt.seated && !p.userData.walking)) {
        p.userData.seated = true;
        if (tgt) {
          p.position.y = tgt.y;
          p.rotation.y = tgt.rotY;
        }
        applySitPose(p, t);
      } else {
        applyIdlePose(p, t);
        if (tgt) p.position.y = tgt.y;
      }

      const beacon = p.userData.overdueBeacon;
      if (beacon && beacon.visible) {
        beacon.rotation.y += dt * 1.15;
        const tip = beacon.children[1];
        if (tip) tip.position.y = 3.35 + Math.sin(t * 3.2) * 0.04;
      }
      if (p.userData.confetti) animateConfetti(p.userData.confetti, t);
      if (p.userData.trophy) p.userData.trophy.rotation.y = t * 0.7;
    });

    st.controls.update();
    st.renderer.render(st.scene, st.camera);
    st.labelRenderer.render(st.scene, st.camera);
  },
};

export default Office3D;
