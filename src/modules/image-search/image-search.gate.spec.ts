// Uji kalibrasi gate Search-by-Image.
//
// Jalankan: pnpm --filter menopos-backend test  (atau `pnpm test` di backend/)
// Memakai test runner bawaan Node (node:test) via tsx — tidak menambah
// dependency baru ke project.
//
// Angka di sini BUKAN karangan: semuanya hasil pengukuran nyata pada katalog
// company Mondelez (68 produk ber-embedding) memakai preprocessing tp2, plus 8
// foto produk company lain sebagai negatif. Kalau kalibrasi diubah, test ini
// harus ikut diperbarui SECARA SADAR.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ABS_FLOOR,
  DEFAULT_ABS_MAX,
  DEFAULT_NEAR_LIMIT,
  DEFAULT_RATIO_MAX,
  DEFAULT_TEXT_ABS_MAX,
  DEFAULT_TEXT_LIMIT,
  MIN_STATS_SAMPLE,
  NEAR_ABS_MAX,
  SMALL_CATALOG_MAX,
  isNearMiss,
  isTextMatch,
  ratioOf,
  resolveGate,
} from "./image-search.gate";

const CATALOG_SIZE = 68;

/** Gate dengan konstanta default — persis seperti produksi tanpa override env. */
function gateFor(median: number | null, sampleSize = CATALOG_SIZE) {
  return resolveGate({
    median,
    sampleSize,
    ratioMax: DEFAULT_RATIO_MAX,
    absMax: DEFAULT_ABS_MAX,
    absFloor: DEFAULT_ABS_FLOOR,
  });
}

function accepts(distance: number, median: number, sampleSize = CATALOG_SIZE) {
  return distance <= gateFor(median, sampleSize).gate;
}

describe("resolveGate — dasar penentuan ambang", () => {
  it("memakai rasio ke median saat sebaran wajar", () => {
    const { gate, basis } = gateFor(0.5585);
    assert.equal(basis, "ratio");
    assert.ok(Math.abs(gate - 0.6 * 0.5585) < 1e-12);
  });

  it("ditahan plafon absolut saat median sangat tinggi", () => {
    // 0.6 x 0.9 = 0.54 → melewati plafon.
    const { gate, basis } = gateFor(0.9);
    assert.equal(basis, "ceiling");
    assert.equal(gate, DEFAULT_ABS_MAX);
  });

  it("diangkat lantai absolut saat median kecil (katalog serba mirip)", () => {
    // 0.6 x 0.2 = 0.12 → lebih ketat dari akurasi model, diangkat ke lantai.
    const { gate, basis } = gateFor(0.2);
    assert.equal(basis, "floor");
    assert.equal(gate, DEFAULT_ABS_FLOOR);
  });

  it("jatuh ke ambang absolut saat katalog terlalu kecil untuk diukur", () => {
    for (const sample of [0, 1, MIN_STATS_SAMPLE - 1]) {
      const { gate, basis } = gateFor(0.5, sample);
      assert.equal(basis, "small-catalog");
      assert.equal(gate, SMALL_CATALOG_MAX);
    }
  });

  it("jatuh ke ambang absolut saat median tidak tersedia", () => {
    for (const median of [null, 0, Number.NaN]) {
      assert.equal(gateFor(median).basis, "small-catalog");
    }
  });

  it("plafon tetap batas keras walau lantai di-set lebih tinggi", () => {
    const { gate } = resolveGate({
      median: 0.1,
      sampleSize: CATALOG_SIZE,
      ratioMax: DEFAULT_RATIO_MAX,
      absMax: 0.15,
      absFloor: 0.4,
    });
    assert.equal(gate, 0.15);
  });
});

describe("kalibrasi: produk ADA di katalog (foto berbeda) harus lolos", () => {
  // [label, jarak ke produk benar, jarak pesaing terdekat, median query]
  const POSITIVES: Array<[string, number, number, number]> = [
    ["aqua botol → aqua gelas", 0.2602, 0.453, 0.5585],
    ["djarum matcha → ghi", 0.1207, 0.5535, 0.6528],
  ];

  for (const [label, target, runnerUp, median] of POSITIVES) {
    it(`${label} diterima, pesaing terdekatnya tidak`, () => {
      assert.ok(accepts(target, median), "hit yang benar harus lolos gate");
      assert.ok(
        !accepts(runnerUp, median),
        "pesaing terdekat harus tetap tersaring",
      );
    });
  }

  it("ambang absolut 0.20 (perilaku lama) membuang hit yang benar", () => {
    // Inilah bug yang diperbaiki. Jarak SEBELUM preprocessing tp2 — keduanya
    // sudah di-rank #1 dengan benar, lalu dibuang oleh
    // IMAGE_SEARCH_MAX_DISTANCE=0.20.
    const BEFORE_PREPROCESSING = [0.3033, 0.2111];
    for (const d of BEFORE_PREPROCESSING) assert.ok(d > 0.2);
    // Preprocessing menolong, tapi tidak menyelamatkan ambang absolut: aqua
    // tetap di atas 0.20 sesudahnya.
    assert.ok(0.2602 > 0.2);
  });
});

describe("kalibrasi: produk TIDAK ADA di katalog harus nol hasil PERSIS", () => {
  // [label, jarak terdekat, median query] — 8 foto produk company lain.
  // "Nol hasil" di sini berarti nol hasil di section "persis". Sejak tier
  // near-miss ada, tetangga terdekatnya masih boleh muncul di section "Gambar
  // serupa" — lihat describe "tier serupa" di bawah.
  const NEGATIVES: Array<[string, number, number]> = [
    ["ABC Biskuit Sandwich Cokelat", 0.4069, 0.494],
    ["ABC Jus Buah Orange", 0.4889, 0.5581],
    ["ABC Keju Cheddar Blok", 0.3261, 0.4457],
    ["kue kering", 0.4153, 0.5318],
    ["Jasa Revisual Promosi", 0.6026, 0.701],
    ["Jasa Revisual & Desain Ulang", 0.5889, 0.6804],
    ["Jasa Revisual Media Toko", 0.5705, 0.6562],
  ];

  for (const [label, best, median] of NEGATIVES) {
    it(`${label} ditolak`, () => {
      assert.ok(!accepts(best, median));
    });
  }

  it("ABC Keju ditolak oleh rasio walau jaraknya di bawah plafon absolut", () => {
    // Bukti kenapa plafon absolut saja tidak cukup: 0.3261 < 0.45.
    assert.ok(0.3261 < DEFAULT_ABS_MAX);
    assert.ok(!accepts(0.3261, 0.4457));
  });
});

describe("kalibrasi: foto katalog itu sendiri (jarak ~0) selalu lolos", () => {
  for (const median of [0.512, 0.3798, 0.3754]) {
    it(`median ${median}`, () => {
      assert.ok(accepts(0, median));
    });
  }
});

describe("ratioOf", () => {
  it("membagi jarak dengan median", () => {
    assert.ok(Math.abs(ratioOf(0.2602, 0.5585) - 0.4659) < 1e-3);
  });

  it("mengembalikan 0 (bukan NaN/Infinity) saat median tidak dipakai", () => {
    assert.equal(ratioOf(0.3, null), 0);
    assert.equal(ratioOf(0.3, 0), 0);
    assert.equal(ratioOf(0.3, Number.NaN), 0);
  });
});

describe('tier "serupa" (near-miss) — gagal gate tapi tetap ditawarkan', () => {
  it("hit yang LOLOS gate bukan near-miss", () => {
    // Tidak boleh dobel: yang lolos gate sudah masuk `hits`.
    const { gate } = gateFor(0.5585);
    assert.ok(!isNearMiss(0.2602, gate));
    assert.ok(!isNearMiss(gate, gate));
  });

  it("pesaing terdekat yang tersaring gate masuk kandidat serupa", () => {
    const { gate } = gateFor(0.5585);
    assert.ok(isNearMiss(0.453, gate));
  });

  it("produk luar katalog tetap masuk kandidat serupa (memang disengaja)", () => {
    // Konsekuensi yang diterima: foto produk asing tidak lagi berujung layar
    // buntu, tapi hasilnya HANYA di section "Gambar serupa", tidak pernah
    // diklaim persis. `IMAGE_SEARCH_NEAR_LIMIT=0` mengembalikan perilaku lama.
    const cases: Array<[number, number]> = [
      [0.4069, 0.494],
      [0.6026, 0.701],
      [0.3261, 0.4457],
    ];
    for (const [best, median] of cases) {
      const { gate } = gateFor(median);
      assert.ok(!accepts(best, median));
      assert.ok(isNearMiss(best, gate));
    }
  });

  it("jarak yang praktis tidak berhubungan tidak ditawarkan", () => {
    const { gate } = gateFor(0.9);
    assert.ok(!isNearMiss(NEAR_ABS_MAX + 1e-9, gate));
    assert.ok(!isNearMiss(1.0, gate));
    assert.ok(!isNearMiss(Number.NaN, gate));
  });

  it("batas kewajaran di atas plafon gate, dan limit-nya kecil", () => {
    assert.ok(NEAR_ABS_MAX > DEFAULT_ABS_MAX);
    assert.ok(DEFAULT_NEAR_LIMIT > 0 && DEFAULT_NEAR_LIMIT <= 12);
  });
});

// ─── Jalur TEKS (SigLIP text tower) ────────────────────────────────
// Semua angka di bawah hasil pengukuran pada katalog yang sama (69 produk
// ber-embedding, model google/siglip-base-patch16-224+tp2).
describe("kalibrasi jalur TEKS: deskripsi yang ADA padanannya harus lolos", () => {
  // [deskripsi, jarak terdekat, nama produk teratas]
  const POSITIVES: Array<[string, number, string]> = [
    ["air mineral", 0.9203, "aqua gelas"],
    ["air mineral botol plastik tanpa label", 0.9284, "aqua gelas"],
    ["air minum kemasan gelas", 0.8932, "aqua gelas"],
    ["bearing bola besi", 0.9168, "Pillow Block UCP 205"],
    ["rantai besi mesin", 0.9068, "Roller Chain RS40 Stainless"],
    ["motor listrik industri", 0.9188, "Gear Motor 0.75 kW"],
    ["pompa air stainless", 0.8925, "Diaphragm Pump 1\" Stainless"],
    ["gearbox reducer", 0.873, "Gearbox Worm WPA 70"],
    ["tombol emergency stop merah", 0.8668, "Emergency Stop Button"],
    ["filter oli", 0.8889, "Oil Filter Spin-on"],
    ["selang pneumatik biru", 0.9214, "Selang PU Air 8mm"],
    ["o-ring karet silikon", 0.8596, "O-ring Set Silikon FDA"],
    ["rokok djarum bungkus", 0.8867, "rokok"],
  ];

  for (const [text, best, top] of POSITIVES) {
    it(`"${text}" → ${top}`, () => {
      assert.ok(isTextMatch(best), `d=${best} harus lolos ambang teks`);
    });
  }

  it("kasus nyata user adalah positif TERJAUH — jadi ambang harus di atasnya", () => {
    const WORST_POSITIVE = 0.9284; // "air mineral botol plastik tanpa label"
    assert.ok(isTextMatch(WORST_POSITIVE));
    assert.ok(DEFAULT_TEXT_ABS_MAX > WORST_POSITIVE);
  });
});

describe("kalibrasi jalur TEKS: deskripsi yang TIDAK ADA harus nol hasil", () => {
  const NEGATIVES: Array<[string, number]> = [
    ["mie instan indomie", 1.004],
    ["sepatu olahraga", 1.0024],
    ["kucing", 0.9931],
    ["sepeda motor honda", 0.9973],
    ["meja kayu", 0.9922],
    ["obat batuk sirup", 0.9605],
    ["bola basket", 0.9957],
    ["kaos katun lengan pendek", 1.0081],
    ["telepon genggam layar sentuh", 0.9659],
  ];

  for (const [text, best] of NEGATIVES) {
    it(`"${text}" ditolak`, () => {
      assert.ok(!isTextMatch(best), `d=${best} harus tersaring`);
    });
  }

  it("ambang berada di tengah jurang positif/negatif", () => {
    const WORST_POSITIVE = 0.9284;
    const BEST_NEGATIVE = 0.9605; // "obat batuk sirup"
    assert.ok(WORST_POSITIVE < BEST_NEGATIVE, "dua sebaran harus terpisah");
    const midpoint = (WORST_POSITIVE + BEST_NEGATIVE) / 2;
    assert.ok(Math.abs(DEFAULT_TEXT_ABS_MAX - midpoint) < 0.005);
  });

  it("ratio ke median DITOLAK sebagai sinyal jalur teks (tumpang tindih)", () => {
    // Inilah kebalikan dari jalur gambar: di sini rasio TIDAK memisahkan.
    const POSITIVE_RATIO_MAX = 0.9214; // "motor listrik industri"
    const NEGATIVE_RATIO_MIN = 0.905; // "obat batuk sirup"
    assert.ok(NEGATIVE_RATIO_MIN < POSITIVE_RATIO_MAX);
  });

  it("skala teks↔gambar jauh di atas skala gambar↔gambar", () => {
    // Kalau ambang gambar dipakai untuk teks, SEMUA hasil akan terbuang.
    assert.ok(DEFAULT_TEXT_ABS_MAX > DEFAULT_ABS_MAX * 2);
    assert.ok(!isTextMatch(1.0));
    assert.ok(!isTextMatch(Number.NaN));
    assert.ok(DEFAULT_TEXT_LIMIT > 0 && DEFAULT_TEXT_LIMIT <= 12);
  });
});
