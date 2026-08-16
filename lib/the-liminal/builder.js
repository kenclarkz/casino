// @ts-nocheck
// Converts a pure FloorData (from levelgen.js) into a three.js scene graph:
// merged room geometry, instanced-ish props, containers, loot, doors, exit,
// lights, per-environment decor (water, rails, void arena).

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T } from './levelgen.js'
import { getEnv } from './environments.js'
import { CONTAINER_TYPES } from './items.js'

export const TILE = 1
export const WALL_H = 3.0

export function tileToWorld(x, y) {
  return { x: x + 0.5, z: y + 0.5 }
}

export function worldToTile(x, z) {
  return { x: Math.floor(x), y: Math.floor(z) }
}

const COLORS = {}

// ---- collision rects (merged wall runs) ----
export function buildCollisionRects(tiles, w, h) {
  const rects = []
  const visited = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (visited[i] || tiles[i] !== T.WALL) continue
      // expand horizontally
      let x2 = x
      while (x2 + 1 < w && !visited[y * w + x2 + 1] && tiles[y * w + x2 + 1] === T.WALL) x2++
      // expand vertically
      let y2 = y
      outer: for (let yy = y + 1; yy < h; yy++) {
        for (let xx = x; xx <= x2; xx++) {
          if (visited[yy * w + xx] || tiles[yy * w + xx] !== T.WALL) break outer
        }
        y2 = yy
      }
      for (let yy = y; yy <= y2; yy++) for (let xx = x; xx <= x2; xx++) visited[yy * w + xx] = 1
      rects.push({ x: x + 0.5, z: y + 0.5, w: x2 - x + 1, d: y2 - y + 1 })
    }
  }
  return rects
}

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color })
}
function basic(color) {
  return new THREE.MeshBasicMaterial({ color })
}

// ---- prop collision table (world units) ----
const PROP_COLLIDE = {
  desk: [1.7, 0.8],
  sofa: [1.9, 0.8],
  counter: [2.2, 0.7],
  pillar: [0.7, 0.7],
  bench: [1.8, 0.6],
  sign: [0.2, 0.2],
  trash: [0.5, 0.5],
  crate: [0.8, 0.8],
  rack: [1.2, 0.5],
  machine: [1.2, 1.0],
  cable: [0.6, 0.3],
  kiosk: [1.2, 1.0],
  escalator: [2.4, 1.2],
  mannequin: [0.5, 0.4],
  plant: [0.5, 0.5],
  bed: [2.0, 1.0],
  gurney: [1.9, 0.8],
  cabinet: [0.8, 0.5],
  monitor: [0.6, 0.5],
  curtain: [0.1, 2.4],
  locker: [0.6, 0.5],
  whiteboard: [0.2, 1.4],
  bookshelf: [1.2, 0.4],
  phone: [0.2, 0.2],
  flag: [0.1, 0.1],
  rail: [2.0, 0.3],
  tunnelDoor: [0.3, 2.0],
  monolith: [1.0, 1.0],
  shard: [0.8, 0.8],
  ladder: [0.6, 0.3],
  bleacher: [2.0, 1.2],
  tile: [0.2, 0.2],
  poolEdge: [0.4, 4.0],
  lamp: [0.3, 0.3],
  door: [1.0, 0.12],
  cubicle: [1.4, 1.4],
  computer: [0.6, 0.5],
  blinds: [0.1, 1.8],
  shelf: [1.2, 0.4],
  bin: [0.6, 0.6],
  box: [0.6, 0.6],
}

const PROP_BLOCK_TILES = new Set(['desk', 'sofa', 'counter', 'pillar', 'bench', 'crate', 'rack', 'machine', 'kiosk', 'escalator', 'mannequin', 'bed', 'gurney', 'cabinet', 'monitor', 'locker', 'bookshelf', 'bleacher', 'monolith', 'shard', 'rail'])

export function propCollides(type) {
  return !!PROP_COLLIDE[type]
}

// Builds a reusable geometry for each prop type. Returns a THREE.Group.
function buildPropMesh(type, mats) {
  const g = new THREE.Group()
  const box = (w, h, d, color, y = h / 2, x = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color))
    m.position.set(x, y, z)
    g.add(m)
    return m
  }
  const cyl = (r, h, color, y = h / 2) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), lambert(color))
    m.position.y = y
    g.add(m)
    return m
  }
  switch (type) {
    case 'desk': {
      box(1.7, 0.08, 0.8, mats.desk, 0.74)
      box(0.08, 0.74, 0.72, mats.deskLeg, 0.37, -0.78)
      box(0.08, 0.74, 0.72, mats.deskLeg, 0.37, 0.78)
      break
    }
    case 'sofa':
      box(1.9, 0.35, 0.8, mats.sofa, 0.35)
      box(1.9, 0.5, 0.2, mats.sofa, 0.6, 0, -0.3)
      box(0.15, 0.5, 0.8, mats.sofa, 0.5, -0.87)
      box(0.15, 0.5, 0.8, mats.sofa, 0.5, 0.87)
      break
    case 'counter':
      box(2.2, 0.1, 0.7, mats.counter, 1.0)
      box(2.2, 0.9, 0.5, mats.counter, 0.45)
      break
    case 'pillar':
      box(0.7, 3.0, 0.7, mats.pillar, 1.5)
      break
    case 'bench':
      box(1.8, 0.08, 0.5, mats.bench, 0.5)
      box(0.1, 0.5, 0.5, mats.benchLeg, 0.25, -0.8)
      box(0.1, 0.5, 0.5, mats.benchLeg, 0.25, 0.8)
      break
    case 'sign':
      box(0.15, 0.5, 1.6, mats.sign, 2.2)
      box(0.15, 0.2, 0.1, mats.signGlow, 2.45)
      break
    case 'trash':
      cyl(0.25, 0.55, mats.trash, 0.28)
      break
    case 'crate':
      box(0.8, 0.8, 0.8, mats.crate, 0.4)
      box(0.84, 0.08, 0.84, mats.crateDark, 0.8)
      break
    case 'rack':
      box(1.2, 0.06, 0.5, mats.rack, 0.5)
      box(1.2, 0.06, 0.5, mats.rack, 1.1)
      box(0.06, 1.2, 0.5, mats.rackLeg, 0.6, -0.57)
      box(0.06, 1.2, 0.5, mats.rackLeg, 0.6, 0.57)
      break
    case 'machine':
      box(1.2, 1.4, 1.0, mats.machine, 0.7)
      box(0.4, 0.3, 0.1, mats.machineScreen, 1.3, 0, 0.51)
      break
    case 'cable':
      box(0.6, 0.06, 0.3, mats.cable, 0.03)
      break
    case 'kiosk':
      box(1.2, 1.6, 1.0, mats.kiosk, 0.8)
      box(0.9, 0.7, 0.1, mats.kioskScreen, 1.1, 0, 0.51)
      break
    case 'escalator':
      box(2.4, 0.15, 1.2, mats.escalator, 0.1)
      box(0.15, 0.9, 1.2, mats.escalator, 0.5, -1.12)
      box(0.15, 0.9, 1.2, mats.escalator, 0.5, 1.12)
      break
    case 'mannequin':
      cyl(0.14, 1.5, mats.mannequin, 1.2)
      cyl(0.3, 0.2, mats.mannequin, 1.6)
      box(0.1, 0.6, 0.1, mats.mannequin, 1.35, 0, 0.2)
      cyl(0.07, 0.8, mats.mannequin, 0.4, 0, 0.22)
      cyl(0.07, 0.8, mats.mannequin, 0.4, 0, -0.22)
      break
    case 'plant':
      cyl(0.25, 0.5, mats.plant, 0.25)
      cyl(0.35, 0.4, mats.plantLeaf, 0.8)
      break
    case 'bed':
      box(2.0, 0.3, 1.0, mats.bed, 0.25)
      box(2.0, 0.1, 1.0, mats.bedSheet, 0.45)
      box(0.3, 0.4, 1.0, mats.bedHead, 0.6, -0.85)
      break
    case 'gurney':
      box(1.9, 0.15, 0.8, mats.gurney, 0.7)
      cyl(0.05, 0.7, mats.gurney, 0.35, -0.8)
      cyl(0.05, 0.7, mats.gurney, 0.35, 0.8)
      break
    case 'cabinet':
      box(0.8, 1.8, 0.5, mats.cabinet, 0.9)
      box(0.7, 0.7, 0.02, mats.cabinetDoor, 1.1, 0, 0.26)
      break
    case 'monitor':
      box(0.6, 0.5, 0.5, mats.monitor, 0.6)
      box(0.4, 0.3, 0.05, mats.monitorScreen, 0.75, 0, 0.26)
      break
    case 'curtain':
      box(0.08, 2.6, 2.4, mats.curtain, 1.4)
      break
    case 'locker':
      box(0.6, 1.9, 0.5, mats.locker, 0.95)
      box(0.55, 0.9, 0.02, mats.lockerDoor, 1.2, 0, 0.26)
      box(0.55, 0.9, 0.02, mats.lockerDoor, 0.6, 0, 0.26)
      break
    case 'whiteboard':
      box(0.05, 1.0, 1.4, mats.whiteboard, 1.6)
      break
    case 'bookshelf':
      box(1.2, 2.0, 0.4, mats.bookshelf, 1.0)
      box(1.1, 0.05, 0.35, mats.bookshelfShelf, 0.7)
      box(1.1, 0.05, 0.35, mats.bookshelfShelf, 1.3)
      break
    case 'phone':
      box(0.18, 0.06, 0.18, mats.phone, 0.75)
      box(0.12, 0.15, 0.12, mats.phone, 0.85)
      break
    case 'flag':
      box(0.05, 0.7, 0.4, mats.flag, 1.6, 0, 0)
      break
    case 'rail': {
      const railLen = 2.0
      box(railLen, 0.08, 0.1, mats.rail, 0.1)
      box(railLen, 0.08, 0.1, mats.rail, 0.1, 0, 0.18)
      for (const z of [-0.18, 0.18]) box(0.08, 0.1, 0.1, mats.rail, 0.05, railLen / 2 - 0.2, z)
      break
    }
    case 'tunnelDoor':
      box(0.3, 2.8, 2.0, mats.tunnelDoor, 1.4)
      break
    case 'monolith':
      box(1.0, 2.4, 1.0, mats.monolith, 1.2)
      box(1.05, 0.15, 1.05, mats.monolithGlow, 2.45)
      break
    case 'shard':
      box(0.8, 1.4, 0.8, mats.shard, 0.7)
      break
    case 'ladder':
      box(0.06, 2.0, 0.4, mats.ladder, 1.0, -0.25)
      box(0.06, 2.0, 0.4, mats.ladder, 1.0, 0.25)
      for (let i = 0; i < 5; i++) box(0.5, 0.04, 0.04, mats.ladder, 0.2 + i * 0.4)
      break
    case 'bleacher':
      box(2.0, 0.5, 1.2, mats.bleacher, 0.25)
      box(2.0, 0.4, 0.4, mats.bleacher, 0.8, 0, -0.4)
      break
    case 'tile':
      box(0.2, 0.02, 0.2, mats.tile, 0.02)
      break
    case 'poolEdge':
      box(0.4, 0.3, 4.0, mats.poolEdge, 0.15)
      break
    case 'lamp':
      box(0.2, 0.15, 0.2, mats.lamp, 2.8)
      box(0.05, 0.05, 0.05, mats.lampGlow, 2.9)
      break
    case 'cubicle':
      box(0.08, 1.5, 1.4, mats.cubicle, 0.75, -0.66)
      box(0.08, 1.5, 1.4, mats.cubicle, 0.75, 0.66)
      box(1.4, 1.5, 0.08, mats.cubicle, 0.75, 0, -0.66)
      box(1.4, 0.9, 0.08, mats.cubicle, 0.45, 0, 0.66)
      break
    case 'computer':
      box(0.5, 0.06, 0.5, mats.computer, 0.7)
      box(0.45, 0.35, 0.04, mats.computerScreen, 0.9, 0, 0.26)
      break
    case 'blinds':
      box(0.05, 1.8, 1.8, mats.blinds, 1.0)
      break
    case 'shelf':
      box(1.2, 0.06, 0.4, mats.shelf, 0.6)
      box(1.2, 0.06, 0.4, mats.shelf, 1.2)
      box(0.06, 1.3, 0.4, mats.shelfLeg, 0.65, -0.55)
      box(0.06, 1.3, 0.4, mats.shelfLeg, 0.65, 0.55)
      break
    default:
      box(0.5, 0.5, 0.5, mats.trash, 0.25)
  }
  return g
}

// Container prop meshes (interactive)
function buildContainerMesh(type, mats) {
  const g = new THREE.Group()
  switch (type) {
    case 'box': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), lambert(mats.boxCardboard))
      base.position.y = 0.225
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.72), lambert(mats.boxLid))
      lid.position.y = 0.48
      g.add(base)
      const pivot = new THREE.Group()
      pivot.position.y = 0.48
      pivot.add(lid)
      g.add(pivot)
      g.userData.pivot = pivot
      break
    }
    case 'locker': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.5), lambert(mats.locker))
      body.position.y = 0.95
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.7, 0.4), lambert(mats.lockerDoor))
      const pivot = new THREE.Group()
      pivot.position.set(0.29, 0.95, 0)
      door.position.x = -0.29
      pivot.add(door)
      g.add(body)
      g.add(pivot)
      g.userData.pivot = pivot
      break
    }
    case 'desk': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.7), lambert(mats.desk))
      top.position.y = 0.7
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.55), lambert(mats.deskDark))
      d.position.set(0.4, 0.5, 0)
      const dp = new THREE.Group()
      dp.position.set(0.4, 0.65, 0)
      d.position.set(0, -0.15, 0)
      dp.add(d)
      g.add(top)
      g.add(dp)
      g.userData.pivot = dp
      break
    }
    case 'shelf': {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.35), lambert(mats.bookshelf)))
      const content = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 0.3), lambert(mats.bookshelfShelf))
      content.position.set(0, 0.1, 0.08)
      const cp = new THREE.Group()
      cp.position.set(0, 0.1, 0.05)
      content.position.z = 0.1
      cp.add(content)
      g.add(cp)
      g.userData.pivot = cp
      break
    }
    case 'cabinet': {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.55), lambert(mats.cabinet)))
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.03), lambert(mats.cabinetDoor))
      door.position.set(0, -0.3, 0.29)
      const pivot = new THREE.Group()
      pivot.position.set(0.42, 0.55, 0)
      door.position.x = -0.42
      pivot.add(door)
      g.add(pivot)
      g.userData.pivot = pivot
      break
    }
    case 'bin': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 12), lambert(mats.bin))
      b.position.y = 0.4
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 12), basic(mats.binGlow))
      glow.position.y = 0.5
      const gp = new THREE.Group()
      gp.position.y = 0.5
      gp.add(glow)
      g.add(b)
      g.add(gp)
      g.userData.pivot = gp
      break
    }
    case 'corpse': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 1.7), lambert(mats.corpse))
      body.position.set(0, 0.15, 0)
      body.rotation.x = 0.1
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lambert(mats.corpse))
      head.position.set(0, 0.35, -0.6)
      g.add(body)
      g.add(head)
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.4), lambert(mats.corpse))
      hand.position.set(0.3, 0.4, -0.1)
      hand.rotation.z = 0.8
      const hp = new THREE.Group()
      hp.add(hand)
      g.add(hp)
      g.userData.pivot = hp
      break
    }
    default:
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lambert(mats.crate)))
  }
  return g
}

// ---- per-environment material set ----
function makeMats(env) {
  const p = env.palette
  return {
    floor: new THREE.MeshLambertMaterial({ color: p.floor }),
    floorAlt: new THREE.MeshLambertMaterial({ color: p.floorAlt }),
    wall: new THREE.MeshLambertMaterial({ color: p.wall }),
    wallAlt: new THREE.MeshLambertMaterial({ color: p.wallAlt }),
    trim: new THREE.MeshLambertMaterial({ color: p.trim }),
    accent: new THREE.MeshLambertMaterial({ color: p.accent }),
    ceiling: new THREE.MeshBasicMaterial({ color: 0x0a0a0c }),
    panel: new THREE.MeshBasicMaterial({ color: p.panel }),
    panelDim: new THREE.MeshBasicMaterial({ color: p.panel }),
    glass: new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.4 }),
    emissive: new THREE.MeshBasicMaterial({ color: 0xffffff }),

    desk: p.floor, deskLeg: p.trim, deskDark: 0x3a3128,
    sofa: 0x56504a, counter: p.wall, pillar: p.wallAlt,
    bench: p.trim, benchLeg: 0x222222, sign: p.accent, signGlow: p.accent,
    trash: 0x333333, crate: 0x6b5638, crateDark: 0x4a3a24,
    rack: 0x666666, rackLeg: 0x444444, machine: p.accent, machineScreen: p.panel,
    cable: 0x333333, kiosk: 0x8a8a8a, kioskScreen: 0x1a2a3a,
    escalator: 0x4a4a52, mannequin: 0xcfc6b8, plant: 0x4a5a3a, plantLeaf: 0x3a4a2a,
    bed: 0x8a8a8a, bedSheet: 0xcfcfcf, bedHead: 0x777777,
    gurney: 0x9a9a9a, cabinet: 0x5a5a5a, cabinetDoor: 0x7a7a7a,
    monitor: 0x333333, monitorScreen: 0x224466,
    curtain: 0x3a4a5a, locker: 0x66758a, lockerDoor: 0x77879c,
    whiteboard: 0xffffff, bookshelf: 0x5a4632, bookshelfShelf: 0x4a3a2a,
    phone: 0x222222, flag: 0x8a2a2a,
    rail: 0x555566, tunnelDoor: 0x3a3a44,
    monolith: 0x26262e, monolithGlow: p.accent, shard: 0x1c1c24,
    ladder: 0x6a6a72, bleacher: 0x4a4a4a, tile: 0x2a5a54, poolEdge: 0x2e5650,
    lamp: 0x333333, lampGlow: p.panel,
    cubicle: 0x9aa0a8, computer: 0x333333, computerScreen: 0x1a2a3a,
    blinds: 0xb8bcc2, shelf: 0x555555, shelfLeg: 0x333333,
    boxCardboard: 0x7a6544, boxLid: 0x6a5636,
    bin: 0x2a2a2a, binGlow: 0x1a3a2a, corpse: 0x3a3a40,

    water: new THREE.MeshBasicMaterial({ color: 0x0c2a26, transparent: true, opacity: 0.75 }),
    railMat: new THREE.MeshBasicMaterial({ color: 0x2a2a30 }),
    safeGlow: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    exitGlow: new THREE.MeshBasicMaterial({ color: p.accent }),
    itemMat: new THREE.MeshBasicMaterial({ color: 0xfff1c0 }),
    noteMat: new THREE.MeshBasicMaterial({ color: 0xe8e2cc }),
    bossCore: new THREE.MeshBasicMaterial({ color: 0x7a1f3d }),
  }
}

/**
 * Build the three.js world for a floor. Returns FloorWorld.
 */
export function buildFloorWorld(floor) {
  const env = getEnv(floor.floorIndex)
  const mats = makeMats(env)
  const group = new THREE.Group()
  const w = floor.w
  const h = floor.h
  const tiles = floor.tiles

  const floorGeos = []
  const wallGeos = []
  const trimGeos = []
  const ceilGeos = []
  const panelGeos = []

  const boxGeo = new THREE.BoxGeometry(1, 1, 1)

  const tilePos = (x, y) => tileToWorld(x, y)

  const pushTransformed = (list, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4()
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
    const g = geo.clone().applyMatrix4(m)
    list.push(g)
  }

  // floor slabs per tile, walls on neighbor edges
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x]
      const isWalk = t !== T.WALL
      if (!isWalk) continue
      const { x: wx, z: wz } = tilePos(x, y)
      const alt = (x + y) % 2 === 0
      // floor
      const slabMat = t === T.WATER ? null : t === T.RAIL ? null : t === T.DOOR ? null : (alt ? mats.floorAlt : mats.floor)
      if (t === T.FLOOR || t === T.DOOR) {
        pushTransformed(floorGeos, boxGeo, wx, -0.05, wz, 0, 0, 0, 1, 0.1, 1)
      }
      if (t === T.WATER) {
        pushTransformed(floorGeos, boxGeo, wx, -0.22, wz, 0, 0, 0, 1, 0.08, 1)
      }
      if (t === T.RAIL) {
        pushTransformed(floorGeos, boxGeo, wx, -0.08, wz, 0, 0, 0, 1, 0.06, 1)
      }
      // ceiling
      pushTransformed(ceilGeos, boxGeo, wx, WALL_H, wz, 0, 0, 0, 1, 0.08, 1)
      // walls where neighbor is wall / out of bounds
      const neighbors = [
        { dx: 0, dz: -1, ry: 0, nz: -0.5, sx: 1, sz: 1 },
        { dx: 0, dz: 1, ry: 0, nz: 0.5, sx: 1, sz: 1 },
        { dx: -1, dz: 0, ry: Math.PI / 2, nx: -0.5, sx: 1, sz: 1 },
        { dx: 1, dz: 0, ry: Math.PI / 2, nx: 0.5, sx: 1, sz: 1 },
      ]
      for (const n of neighbors) {
        const nx = x + n.dx
        const ny = y + n.dz
        let blocked = false
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) blocked = true
        else blocked = tiles[ny * w + nx] === T.WALL
        if (!blocked) continue
        let px = wx
        let pz = wz
        if (n.nz !== undefined) pz = wz + n.nz
        if (n.nx !== undefined) px = wx + n.nx
        const wallAlt = (x * 7 + y * 13) % 5 === 0
        pushTransformed(wallGeos, boxGeo, px, WALL_H / 2, pz, 0, n.ry || 0, 0, n.sx, WALL_H, n.sz)
        // baseboard trim
        pushTransformed(trimGeos, boxGeo, px, 0.18, pz, 0, n.ry || 0, 0, n.sx, 0.22, n.sz * 1.05)
      }
    }
  }

  // merge geometries
  const mkMesh = (geos, mat) => {
    if (!geos.length) return null
    const merged = mergeGeometries(geos)
    const mesh = new THREE.Mesh(merged, mat)
    mesh.matrixAutoUpdate = false
    return mesh
  }
  const floorMesh = mkMesh(floorGeos, mats.floor)
  const wallMesh = mkMesh(wallGeos, mats.wall)
  const trimMesh = mkMesh(trimGeos, mats.trim)
  const ceilMesh = mkMesh(ceilGeos, mats.ceiling)
  if (floorMesh) group.add(floorMesh)
  if (wallMesh) group.add(wallMesh)
  if (trimMesh) group.add(trimMesh)
  if (ceilMesh) group.add(ceilMesh)

  // ceiling light panels (emissive)
  const panelGeo = new THREE.BoxGeometry(0.5, 0.03, 1.2)
  const panels = []
  for (const l of floor.lights) {
    const { x: wx, z: wz } = tilePos(l.x, l.y)
    const mesh = new THREE.Mesh(panelGeo, mats.panel.clone())
    mesh.position.set(wx, WALL_H - 0.12, wz)
    mesh.rotation.y = (l.x + l.y) % 2 === 0 ? 0 : Math.PI / 2
    group.add(mesh)
    panels.push({ mesh, flicker: l.flicker, on: l.on })
  }

  // water surface (pool)
  let waterGroup = null
  if (floor.waterZones.length) {
    waterGroup = new THREE.Group()
    const wgeo = new THREE.PlaneGeometry(1, 1)
    for (const zr of floor.waterZones) {
      for (let y = zr.y; y < zr.y + zr.h; y++) {
        for (let x = zr.x; x < zr.x + zr.w; x++) {
          if (tiles[y * w + x] !== T.WATER) continue
          const m = new THREE.Mesh(wgeo, mats.water)
          m.position.set(x + 0.5, 0.02, y + 0.5)
          m.rotation.x = -Math.PI / 2
          waterGroup.add(m)
        }
      }
    }
    group.add(waterGroup)
  }

  // rails (metro)
  let railGroup = null
  if (floor.rails.length) {
    railGroup = new THREE.Group()
    const railGeo = new THREE.BoxGeometry(0.08, 0.08, 1)
    const tieGeo = new THREE.BoxGeometry(0.5, 0.04, 0.12)
    const run = groupRuns(floor.rails)
    for (const r of run) {
      for (let i = 0; i < r.len; i++) {
        const x = r.horizontal ? r.start + i : r.start
        const y = r.horizontal ? r.y : r.y + i
        const wx = x + 0.5
        const wz = y + 0.5
        const m1 = new THREE.Mesh(railGeo, mats.railMat)
        m1.position.set(wx, 0.08, wz - 0.18)
        railGroup.add(m1)
        const m2 = new THREE.Mesh(railGeo, mats.railMat)
        m2.position.set(wx, 0.08, wz + 0.18)
        railGroup.add(m2)
        const tie = new THREE.Mesh(tieGeo, mats.railMat)
        tie.position.set(wx, 0.04, wz)
        railGroup.add(tie)
      }
    }
    group.add(railGroup)
  }

  // ---- collision rects ----
  const colliders = buildCollisionRects(tiles, w, h)

  // ---- props ----
  const propGeos = new Map()
  const propMesh = (type) => {
    if (!propGeos.has(type)) propGeos.set(type, buildPropMesh(type, mats))
    return propGeos.get(type).clone(true)
  }
  for (const p of floor.props) {
    const mesh = propMesh(p.type)
    const { x, z } = tileToWorld(p.x, p.y)
    mesh.position.set(x, 0, z)
    mesh.rotation.y = p.rot
    group.add(mesh)
    if (PROP_COLLIDE[p.type]) {
      const [pw, pd] = PROP_COLLIDE[p.type]
      colliders.push({ x, z, w: pw, d: pd })
    }
  }

  // ---- doors ----
  const doors = new Map()
  for (const d of floor.doors) {
    const { x, z } = tileToWorld(d.x, d.y)
    const pivot = new THREE.Group()
    pivot.position.set(x, 0, z)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.12), mats.trim)
    frame.position.y = 1.1
    pivot.add(frame)
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.05, 0.08), lambert(env.palette.wallAlt))
    doorMesh.position.set(0.44, 1.05, 0)
    pivot.add(doorMesh)
    group.add(pivot)
    const doorObj = { id: d.id || `${d.x}-${d.y}`, x: x, z: z, pivot, doorMesh, open: d.open, targetOpen: d.open, rot: d.rot || 0 }
    doorObj.rot = (d.rot) + Math.PI / 2
    doorMesh.position.set(doorObj.rot === 0 || doorObj.rot === Math.PI ? 0 : 0.44, 1.05, 0)
    // simpler: hinged on one side
    pivot.children[1].position.set(0.46, 1.05, 0)
    pivot.children[1].position.x = 0.46
    doorObj.update = (dt) => {
      doorObj.open += (doorObj.targetOpen ? 1 : -1) * Math.min(1, dt * 3)
      doorObj.open = THREE.MathUtils.clamp(doorObj.open, 0, 1)
      doorObj.pivot.children[1].rotation.y = -doorObj.open * Math.PI * 0.85
      doorObj.pivot.children[1].position.x = 0.46 - doorObj.open * 0.12
    }
    doorObj.update(0.016)
    doors.set(doorObj.id, doorObj)
  }

  // ---- containers ----
  const containers = new Map()
  for (const c of floor.containers) {
    const { x, z } = tileToWorld(c.x, c.y)
    const mesh = buildContainerMesh(c.type, mats)
    mesh.position.set(x, 0, z)
    mesh.rotation.y = (c.x * 3 + c.y * 5) % 2 === 0 ? 0 : Math.PI / 2
    group.add(mesh)
    const def = CONTAINER_TYPES[c.type]
    const [cw, cd] = { box: [0.72, 0.72], locker: [0.6, 0.5], desk: [1.4, 0.7], shelf: [1.1, 0.35], cabinet: [0.9, 0.55], bin: [0.8, 0.8], corpse: [0.5, 1.7] }[c.type]
    colliders.push({ x, z, w: cw, d: cd })
    containers.set(c.id, {
      id: c.id, x, z, type: c.type, mesh, open: false,
      def,
      interact: (dt) => { containers.get(c.id).open = true },
    })
  }

  // ---- loose loot ----
  const lootMeshes = new Map()
  for (const l of floor.loot) {
    const { x, z } = tileToWorld(l.x, l.y)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mats.itemMat.clone())
    mesh.position.set(x, 0.12 + Math.sin(l.x + l.y) * 0.02, z)
    group.add(mesh)
    lootMeshes.set(l.id, { id: l.id, x, z, mesh, item: l.item, count: l.count, taken: false, t: 0 })
  }

  // ---- notes (lore pickups) ----
  const noteMeshes = new Map()
  for (let i = 0; i < env.lore.length; i++) {
    const room = floor.rooms[(floor.safeRoom + 2 + i * 2) % floor.rooms.length]
    const x = room.x + 1
    const y = room.y + 1
    const { x: wx, z: wz } = tileToWorld(x, y)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.14), mats.noteMat.clone())
    mesh.position.set(wx, 0.9, wz)
    group.add(mesh)
    noteMeshes.set(`note_${i}`, { id: `note_${i}`, x: wx, z: wz, mesh, noteIndex: i, taken: false })
  }

  // ---- safe room table ----
  let safeMesh = null
  if (floor.safeRoom >= 0) {
    const sr = floor.rooms[floor.safeRoom]
    const { x, z } = tileToWorld(Math.floor(sr.cx), Math.floor(sr.cy))
    safeMesh = new THREE.Group()
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.5), lambert(mats.desk))
    table.position.y = 0.4
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.18), mats.safeGlow)
    lantern.position.set(0.3, 0.9, 0)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mats.safeGlow.clone())
    glow.position.set(0.3, 1.0, 0)
    glow.material.transparent = true
    glow.material.opacity = 0.25
    safeMesh.add(table)
    safeMesh.add(lantern)
    safeMesh.add(glow)
    safeMesh.position.set(x, 0, z)
    group.add(safeMesh)
    colliders.push({ x: x + 0.0, z: z, w: 1.0, d: 0.5 })
  }

  // ---- exit ----
  const exitTile = floor.exit
  const { x: ex, z: ez } = tileToWorld(exitTile.x, exitTile.y)
  const exitGroup = new THREE.Group()
  const exitFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.4), lambert(env.palette.accent))
  exitFrame.position.y = 1.2
  exitGroup.add(exitFrame)
  const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.1, 0.2), mats.exitGlow.clone())
  exitDoor.position.y = 1.05
  exitDoor.material.color = new THREE.Color(env.palette.panel)
  exitGroup.add(exitDoor)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), mats.exitGlow.clone())
  glow.position.y = 0.6
  glow.material.transparent = true
  glow.material.opacity = 0.4
  exitGroup.add(glow)
  // stairs going down
  for (let i = 0; i < 4; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), lambert(env.palette.wallAlt))
    step.position.set(0, 0.09 + i * 0.18, 1 + i * 0.5)
    exitGroup.add(step)
  }
  exitGroup.position.set(ex, 0, ez)
  group.add(exitGroup)

  // ---- lights ----
  const lights = []
  const envAmb = env.ambient
  const envLightColor = env.lightColor
  for (const l of floor.lights) {
    const { x, z } = tileToWorld(l.x, l.y)
    const pl = new THREE.PointLight(envLightColor, 0, 12, 1.4)
    pl.position.set(x, WALL_H - 0.4, z)
    group.add(pl)
    lights.push({ light: pl, x, z, base: env.lightIntensity, flicker: l.flicker, on: true })
  }

  const collidersIdx = new Map()
  colliders.forEach((c, i) => collidersIdx.set(i, c))

  return {
    group,
    mats,
    colliders,
    doors,
    containers,
    lootMeshes,
    noteMeshes,
    exitGroup,
    exitPos: { x: ex, z: ez },
    safePos: safeMesh ? { x: safeMesh.position.x, z: safeMesh.position.z } : null,
    safeMesh,
    panels,
    lights,
    waterGroup,
    railGroup,
    tileAt: (wx, wz) => {
      const tx = Math.floor(wx)
      const ty = Math.floor(wz)
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return T.WALL
      return tiles[ty * w + tx]
    },
    surfaceAt: (wx, wz) => {
      const t = { T } && T
      const tt = floor.tiles[Math.floor(wz) * w + Math.floor(wx)]
      if (tt === T.WATER) return 'water'
      if (tt === T.RAIL) return 'metal'
      return 'tile'
    },
  }
}

/** Group a list of rail points into contiguous runs. */
function groupRuns(points) {
  if (!points.length) return []
  const byY = new Map()
  for (const p of points) {
    if (!byY.has(p.y)) byY.set(p.y, [])
    byY.get(p.y).push(p.x)
  }
  const runs = []
  for (const [y, xs] of byY) {
    xs.sort((a, b) => a - b)
    let start = xs[0]
    let prev = xs[0]
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === prev + 1) {
        prev = xs[i]
      } else {
        runs.push({ start, len: prev - start + 1, y, horizontal: true })
        start = xs[i]
        prev = xs[i]
      }
    }
    runs.push({ start, len: prev - start + 1, y, horizontal: true })
  }
  return runs
}
