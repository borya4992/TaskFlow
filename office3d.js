/**
 * TaskFlow — 3D Ofis (admin)
 * Low-poly ofis personajlari (erkak/ayol na'muna) + ish stoli + yurish/o'tirish animatsiyasi.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const MANAGEMENT_LEVELS = new Set(['direktor', 'orinbosar', 'bolim_boshligi']);
const STAY_AT_DESK_LEVELS = new Set(['direktor', 'orinbosar']);

/** 3D ofisdagi ish xonalari (Admin ko'rinmaydi) */
export const OFFICE_WORK_DEPARTMENTS = ['Xodimlar', 'Ishga qabul qilish', 'Kompensatsiya'];

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

/** Stol usti (workstation local Y) — qo'llar shu balandlikka tenglashadi */
const DESK_TOP_Y = 0.72;
const CHAIR_SEAT_Y = 0.42;
/** O'tirganda root pastroq — qo'l stol bilan tekis */
const SIT_ROOT_Y = 0.26;

const WALK_SPEED = 2.6; // o'rtacha tezlik (birlik/sek)

function genderOf(u) {
  return u?.gender === 'ayol' ? 'ayol' : 'erkak';
}

function normalizeOfficeDepartment(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'admin' || s === 'админ' || s === 'boshqa' || s === "boshqa") return 'Xodimlar';
  for (const d of OFFICE_WORK_DEPARTMENTS) {
    if (d.toLowerCase() === s) return d;
  }
  if (s.includes('qabul') || s.includes('hr') || s.includes('recruit')) return 'Ishga qabul qilish';
  if (s.includes('kompens') || s.includes('payroll') || s.includes('moliya')) return 'Kompensatsiya';
  if (s.includes('xodim') || s.includes('staff') || s.includes('personnel')) return 'Xodimlar';
  if (s.includes('boshqaruv') || s.includes('management')) return 'Xodimlar';
  return 'Xodimlar';
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

/** Low-poly humanoid (kapsula/sfera — kvadrat emas), na'munaga yaqin */
function createPersonMesh(level, gender) {
  const g = genderOf({ gender });
  const p = CHARACTER_PRESETS[g] || CHARACTER_PRESETS.erkak;
  const root = new THREE.Group();
  // Boshqaruv ham bir xil o'lcham — oyoqlar polga tegadi
  const scale = 1;
  root.scale.setScalar(scale);

  const skinM = mat(p.skin, { roughness: 0.72 });
  const shirtM = mat(p.shirt, { roughness: 0.55 });
  const pantsM = mat(p.pants, { roughness: 0.7 });
  const hairM = mat(p.hairColor, { roughness: 0.88 });
  const shoeM = mat(p.shoes, { roughness: 0.8 });
  const segs = 6;

  // —— Bosh (yumaloq) ——
  const head = new THREE.Mesh(new THREE.SphereGeometry(p.headR, 10, 8), skinM);
  head.position.y = 1.58;
  root.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, segs), skinM);
  neck.position.y = 1.44;
  root.add(neck);

  if (p.hair === 'ponytail') {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 1.05, 10, 8), hairM);
    hairCap.position.y = 1.62;
    hairCap.scale.set(1.05, 0.75, 1.05);
    root.add(hairCap);
    const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 6), hairM);
    pony.position.set(0, 1.42, -0.14);
    pony.rotation.x = 0.55;
    root.add(pony);
  } else {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 1.08, 10, 8), hairM);
    hairCap.position.y = 1.64;
    hairCap.scale.set(1.02, 0.55, 1.05);
    root.add(hairCap);
  }

  // —— Torso (kapsula — humanoid) ——
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 1.12;
  root.add(torsoGroup);
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(p.torsoR, p.torsoLen, 4, segs),
    shirtM
  );
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
    arm.position.set(side * p.shoulder, 1.32, 0);
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

  // —— Bel / oyoqlar (oyoq pastki qismi ~ y=0) ——
  const hip = new THREE.Group();
  hip.position.y = 0.95;
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
    leg.position.set(side * 0.1, -0.04, 0);
    const thighLen = Math.max(p.thigh, 0.4);
    const shinLen = Math.max(p.shin, 0.38);
    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.055, thighLen * 0.55, 3, segs),
      pantsM
    );
    thigh.position.y = -thighLen * 0.35;
    leg.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -thighLen * 0.72;
    const shinMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.048, shinLen * 0.5, 3, segs),
      pantsM
    );
    shinMesh.position.y = -shinLen * 0.32;
    shin.add(shinMesh);
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.12, 3, 6), shoeM);
    shoe.rotation.z = Math.PI / 2;
    shoe.position.set(0, -shinLen * 0.62, 0.05);
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
    crown.position.y = 1.78;
    root.add(crown);
  } else if (level === 'orinbosar') {
    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06),
      mat(0xc0c8d4, { metalness: 0.65, roughness: 0.3 })
    );
    badge.position.y = 1.76;
    root.add(badge);
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
    head,
    torso: torsoGroup,
    armRestY: 1.32,
    baseScale: scale,
    gender: g,
    standY: 0,
  };
  return root;
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
  seat.position.set(0, 0.42, 0.55);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.06), black);
  back.position.set(0, 0.72, 0.74);
  g.add(back);
  const chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 8), metal);
  chairBase.position.set(0, 0.08, 0.55);
  g.add(chairBase);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 8), metal);
  pole.position.set(0, 0.24, 0.55);
  g.add(pole);

  g.userData.isOfficeProp = true;
  g.userData.sitLocal = new THREE.Vector3(0, 0, 0.55);
  g.userData.deskTopY = DESK_TOP_Y;
  g.userData.chairSeatY = CHAIR_SEAT_Y;
  g.userData.faceYaw = rotY + Math.PI; // stulga o'tirib monitorga qarash
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

function applyStatusVisual(person, status) {
  person.userData.statusKind = status.kind;
  if (person.userData.labelEl) {
    updateLabelEl(person.userData.labelEl, person.userData.user, status, person.userData.level);
  }
  // Kechikkan — engil qizil glow (kiyim rangini buzmasdan)
  const shirt = person.userData.shirtM;
  if (shirt) {
    if (status.kind === 'overdue') {
      shirt.emissive.setHex(0xf2635c);
      shirt.emissiveIntensity = 0.25;
    } else {
      shirt.emissive.setHex(0x000000);
      shirt.emissiveIntensity = 0;
    }
  }
}

function resetLimbPose(person) {
  const ud = person.userData;
  if (ud.armL) {
    ud.armL.rotation.set(0, 0, 0.12);
    if (ud.armRestY != null) ud.armL.position.y = ud.armRestY;
  }
  if (ud.armR) {
    ud.armR.rotation.set(0, 0, -0.12);
    if (ud.armRestY != null) ud.armR.position.y = ud.armRestY;
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
  // Yelkalar pastroq — qo'l stol usti (DESK_TOP_Y) bilan tekis
  if (ud.armL) ud.armL.position.y = (ud.armRestY || 1.32) - 0.28;
  if (ud.armR) ud.armR.position.y = (ud.armRestY || 1.32) - 0.28;
  if (ud.hip) ud.hip.rotation.x = 0.05;
  if (ud.legL) ud.legL.rotation.set(-Math.PI / 2 + 0.08, 0.04, 0);
  if (ud.legR) ud.legR.rotation.set(-Math.PI / 2 + 0.08, -0.04, 0);
  if (ud.shinL) ud.shinL.rotation.x = Math.PI / 2 - 0.05;
  if (ud.shinR) ud.shinR.rotation.x = Math.PI / 2 - 0.05;
  // Qo'llar: bilak stol ustida, barmoqlar klaviaturada
  if (ud.armL) ud.armL.rotation.set(-1.25, 0.12, 0.65);
  if (ud.armR) ud.armR.rotation.set(-1.25, -0.12, -0.65);
  if (ud.forearmL) ud.forearmL.rotation.set(-0.75 + Math.sin(t * 11) * 0.16, 0, 0.08);
  if (ud.forearmR) ud.forearmR.rotation.set(-0.75 + Math.sin(t * 11 + 1.2) * 0.16, 0, -0.08);
  if (ud.torso) ud.torso.rotation.x = 0.1;
  if (ud.head) ud.head.rotation.set(-0.06, 0, 0);
}

function applyIdlePose(person, t) {
  resetLimbPose(person);
  const ud = person.userData;
  if (ud.armL) ud.armL.rotation.z = 0.12 + Math.sin(t * 1.2) * 0.03;
  if (ud.armR) ud.armR.rotation.z = -0.12 - Math.sin(t * 1.2 + 0.5) * 0.03;
  if (ud.head) ud.head.rotation.y = Math.sin(t * 0.7) * 0.08;
}

function applyWalkPose(person, t) {
  const ud = person.userData;
  if (ud.armRestY != null) {
    if (ud.armL) ud.armL.position.y = ud.armRestY;
    if (ud.armR) ud.armR.position.y = ud.armRestY;
  }
  const swing = Math.sin(t * 8) * 0.55;
  if (ud.legL) ud.legL.rotation.x = swing;
  if (ud.legR) ud.legR.rotation.x = -swing;
  if (ud.shinL) ud.shinL.rotation.x = Math.max(0, -swing) * 0.4;
  if (ud.shinR) ud.shinR.rotation.x = Math.max(0, swing) * 0.4;
  if (ud.armL) ud.armL.rotation.x = -swing * 0.7;
  if (ud.armR) ud.armR.rotation.x = swing * 0.7;
  if (ud.forearmL) ud.forearmL.rotation.x = 0.2;
  if (ud.forearmR) ud.forearmR.rotation.x = 0.2;
  if (ud.hip) ud.hip.rotation.x = 0;
  if (ud.torso) ud.torso.rotation.x = 0.05;
  if (ud.head) ud.head.rotation.set(0, 0, 0);
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
      console.info('[Office3D] build 20260722c — humanoid capsules, pink women, sit desk-align');
    } catch (_) {}
  },

  update(users, tasks) {
    if (!this._state) return;
    const key = this._layoutKey(users || []);
    if (key !== this._state.layoutKey) {
      this._buildWorld(users || [], tasks || []);
    } else {
      this._updatePeopleStates(users || [], tasks || []);
    }
  },

  applyTheme() {
    if (!this._state) return;
    this._state.colors = this._readColors(this._state.getThemeColors);
    this._state.scene.background.setHex(this._state.colors.bg);
    if (this._state.scene.fog) this._state.scene.fog.color.setHex(this._state.colors.bg);
    this._state.people.forEach((p) => {
      applyStatusVisual(p, p.userData.lastStatus || { kind: 'free', label: 'Dam olish' });
    });
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

  _makeRoom(cx, cz, w, d, label, floorColor) {
    const st = this._state;
    const colors = st.colors;
    this._floor(w, d, 0.02, floorColor, cx, cz);
    this._wall(w, 1.2, 0.12, cx, 0.65, cz - d / 2, colors.border);
    this._wall(0.12, 1.2, d, cx - w / 2, 0.65, cz, colors.border);
    this._wall(0.12, 1.2, d, cx + w / 2, 0.65, cz, colors.border);
    this._roomLabel(label, cx, cz - d / 2 + 0.4);
  },

  _addWorkstationAt(x, z, rotY, platformY = 0) {
    const st = this._state;
    const ws = createWorkstation(rotY);
    ws.position.set(x, platformY, z);
    st.scene.add(ws);
    st.workstations.push(ws);
    const sit = ws.userData.sitLocal.clone();
    sit.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    // Platforma usti (pol) — oyoqlar shu yerga tegadi
    const floorY = platformY + 0.04;
    return {
      x: x + sit.x,
      y: platformY + SIT_ROOT_Y,
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

    // Direktor / o'rinbosar — bo'sh bo'lsa ham Boshqaruvda qoladi
    if (STAY_AT_DESK_LEVELS.has(level)) {
      const desk = st.deskSlots.boshqaruv || {};
      const seats = desk.seats || [];
      const i = Math.max(0, (desk.managers || []).indexOf(user.id));
      const seat = seats[i] || seats[0] || { x: 0, y: 0.42, z: -8, rotY: 0, standY: 0.35, zone: 'work' };
      return {
        ...seat,
        seated: isWorking,
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
      const slot = st.restSlots[idx] || { x: 0, y: 0, z: 10, rotY: 0 };
      return { ...slot, seated: false, zone: 'rest' };
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
    const colors = st.colors;

    this._floor(42, 42, 0, colors.panel, 0, 0);

    // —— Boshqaruv (platforma) ——
    const platformY = 0.35;
    this._floor(14, 5, platformY, colors.border, 0, -8);
    this._roomLabel('Boshqaruv', 0, -8);
    const mgrFloorY = platformY + 0.04;

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
      const seat = this._addWorkstationAt(x, -8.15, 0, platformY);
      // Bo'sh: platforma polida tik turish (oyoqlar tegadi)
      seat.standPos = { x: seat.x, y: mgrFloorY, z: seat.z + 0.2 };
      mgrSeats.push(seat);
    });
    st.deskSlots.boshqaruv = { managers: managers.map((u) => u.id), seats: mgrSeats };

    // —— 3 ish bo'limi ——
    const roomW = 9;
    const roomD = 8;
    const workRooms = [
      { name: 'Xodimlar', cx: -10, cz: 2.5, floor: 0x1a2233 },
      { name: 'Ishga qabul qilish', cx: 0, cz: 2.5, floor: 0x162030 },
      { name: 'Kompensatsiya', cx: 10, cz: 2.5, floor: 0x1a2233 },
    ];
    workRooms.forEach((r) => {
      this._makeRoom(r.cx, r.cz, roomW, roomD, r.name, r.floor);
    });

    // —— Dam olish ——
    const restW = 16;
    const restD = 6.5;
    const restCx = 0;
    const restCz = 12;
    this._makeRoom(restCx, restCz, restW, restD, 'Dam olish', 0x1e2838);
    const sofa = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.4, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.8 })
    );
    sofa.position.set(restCx, 0.28, restCz + 1.4);
    sofa.userData.isOfficeProp = true;
    st.scene.add(sofa);

    st.restSlots = [];
    for (let i = 0; i < 24; i++) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      st.restSlots.push({
        x: restCx - restW / 2 + 1.3 + col * 1.7,
        y: 0,
        z: restCz - restD / 2 + 1.4 + row * 1.55,
        rotY: Math.PI,
        seated: false,
        zone: 'rest',
      });
    }

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

    team.forEach((u) => {
      const status = userWorkStatus(u, tasks);
      const pose = this._resolvePose(u, status);
      this._placePerson(u, pose, tasks);
    });
  },

  _resolvePose(user, status) {
    const pose = this._targetPose(user, status);
    const level = positionLevelOf(user);
    // Menejerlar bo'sh: tik turish
    if (STAY_AT_DESK_LEVELS.has(level) && !pose.seated && pose.standPos) {
      return {
        x: pose.standPos.x,
        y: pose.standPos.y,
        z: pose.standPos.z,
        rotY: pose.rotY,
        seated: false,
        zone: 'work',
      };
    }
    if (STAY_AT_DESK_LEVELS.has(level) && !pose.seated) {
      return { ...pose, y: pose.standY ?? pose.standPos?.y ?? 0.39, seated: false };
    }
    return pose;
  },

  _placePerson(user, pose, tasks) {
    const st = this._state;
    const level = positionLevelOf(user);
    const g = genderOf(user);
    const status = userWorkStatus(user, tasks);
    const person = createPersonMesh(level, g);
    person.position.set(pose.x, pose.y ?? 0, pose.z);
    person.rotation.y = pose.rotY || 0;
    person.userData.baseY = pose.y ?? 0;
    person.userData.userId = user.id;
    person.userData.user = user;
    person.userData.level = level;
    person.userData.gender = g;
    person.userData.lastStatus = status;
    person.userData.zone = pose.zone;
    person.userData.seated = !!pose.seated;
    person.userData.target = { x: pose.x, y: pose.y ?? 0, z: pose.z, rotY: pose.rotY || 0, seated: !!pose.seated };
    person.userData.walking = false;
    person.castShadow = true;

    const labelEl = makeLabelEl(user, status, level);
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 1.95, 0);
    person.add(label);
    person.userData.labelEl = labelEl;

    applyStatusVisual(person, status);
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
    };
    person.userData.zone = pose.zone;
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
      applyStatusVisual(person, status);
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
    });

    st.controls.update();
    st.renderer.render(st.scene, st.camera);
    st.labelRenderer.render(st.scene, st.camera);
  },
};

export default Office3D;
