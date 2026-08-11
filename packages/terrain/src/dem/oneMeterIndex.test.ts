/**
 * Tests for 1 m project discovery.
 *
 * Three kinds of evidence, as in `cog.test.ts`:
 *
 *  - **Closed form / by construction.** A 10 km cell index is exactly
 *    `floor(easting / 10000)`, so a point at a known UTM coordinate has a
 *    derivable cell.
 *  - **Pinned real values.** File names, project names and the naming-variant
 *    census were read from the live `prd-tnm` bucket while this was built.
 *    They are recorded here so a later refactor cannot silently move them.
 *    Marked where they appear.
 *  - **Real synthetic rasters.** The verification gate is exercised against
 *    actual GeoTIFFs written by `writeSyntheticTiff` and read back through the
 *    real `CogReader`, not against stubs — the gate's whole job is to believe
 *    the *file* over the index, so a stubbed file would test nothing.
 */

import { describe, expect, it } from 'vitest';
import { CogReader } from './cog.js';
import { NODATA } from './encoding.js';
import { lngLatToUtm, nad83UtmEpsg, utmZoneForLongitude } from './projection.js';
import { oneMeterTileName } from './usgs3dep.js';
import { writeSyntheticTiff } from '../testing/syntheticTiff.js';
import {
  buildOneMeterIndex,
  cellKey,
  listOneMeterProjects,
  OneMeterIndex,
  oneMeterManifestUrl,
  oneMeterStems,
  oneMeterTileUrl,
  parseOneMeterFileName,
  parseOneMeterManifest,
  parseS3ListXml,
  resolveOneMeterTile,
  s3ListUrl,
} from './oneMeterIndex.js';

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

describe('1 m file naming', () => {
  /**
   * Pinned real names, one per convention, taken from the live bucket. The
   * census behind them: of 919 projects with a readable TIFF listing,
   * `USGS_one_meter_` is used by 515, `USGS_1M_{zone}_` by 345, `USGS_1m_` by
   * 59. That distribution is the reason all three exist here — the original
   * `oneMeterTileName` emitted only the middle one and would therefore have
   * reported "no 1 m data" over 62% of the country's projects.
   */
  it('parses all three real naming conventions', () => {
    expect(parseOneMeterFileName('USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif')).toEqual({
      stemId: '1M_zone',
      zone: 16,
      x: 27,
      y: 405,
      project: 'KY_Statewide_2021_A21',
    });
    expect(parseOneMeterFileName('USGS_1m_x51y383_AL_25Co_B1_2017.tif')).toEqual({
      stemId: '1m',
      zone: undefined,
      x: 51,
      y: 383,
      project: 'AL_25Co_B1_2017',
    });
    expect(parseOneMeterFileName('USGS_one_meter_x47y534_Elwha_River_LiDAR_2014_MOD2.tif')).toEqual(
      {
        stemId: 'one_meter',
        zone: undefined,
        x: 47,
        y: 534,
        project: 'Elwha_River_LiDAR_2014_MOD2',
      },
    );
  });

  it('keeps project names containing digits, underscores and "x" intact', () => {
    // `AL_25Co_B1_2017` defeats any split-on-underscore approach, which is why
    // the parser anchors on the `x#y#` group instead.
    const p = parseOneMeterFileName(
      'USGS_1M_18_x54y491_2014_New_York_Clinton_Essex_Lake_Champlain_QL2_LiDAR.tif',
    );
    expect(p?.project).toBe('2014_New_York_Clinton_Essex_Lake_Champlain_QL2_LiDAR');
    expect(p?.zone).toBe(18);
  });

  it('rejects the non-tile files that share these directories', () => {
    // All observed in the live bucket. A sidecar counted as a tile would put a
    // project in the index for a cell it does not actually publish imagery for.
    for (const name of [
      'Thumbs.db',
      'Copy.bat',
      'USGS_1M_16_x27y405_KY_Statewide_2021_A21.xml',
      'USGS_1M_11_x44y370_San_Diego_CA_2014_LiDAR.tif.aux.xml',
      'USGS_13_n38w085.tif',
      '',
    ]) {
      expect(parseOneMeterFileName(name)).toBeNull();
    }
  });

  it('round-trips a name through the stem builder', () => {
    const stems = oneMeterStems(16, 27, 405);
    expect(stems).toContain('USGS_1M_16_x27y405');
    for (const stem of stems) {
      const parsed = parseOneMeterFileName(`${stem}_KY_Statewide_2021_A21.tif`);
      expect(parsed).not.toBeNull();
      expect(parsed?.x).toBe(27);
      expect(parsed?.y).toBe(405);
    }
  });

  it('builds the exact URL observed in the bucket', () => {
    expect(oneMeterTileUrl('KY_Statewide_2021_A21', 'USGS_1M_16_x27y405')).toBe(
      'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/' +
        'KY_Statewide_2021_A21/TIFF/USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif',
    );
    expect(oneMeterManifestUrl('KY_Statewide_2021_A21')).toBe(
      'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/' +
        'KY_Statewide_2021_A21/0_file_download_links.txt',
    );
  });

  it('offers every naming convention from oneMeterTileName', () => {
    // The regression this pins: `stems` used to be a single zoned string, so a
    // probe missed the 574 projects that use an unzoned name.
    const tile = oneMeterTileName(-85.6556, 37.9186, 16);
    expect(tile.stems).toHaveLength(3);
    expect(tile.stems).toContain(tile.stem);
    for (const stem of tile.stems) {
      expect(parseOneMeterFileName(`${stem}_P.tif`)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// S3 listing
// ---------------------------------------------------------------------------

/** Trimmed from a real `ListObjectsV2` response for the 1 m project prefix. */
const REAL_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>prd-tnm</Name><Prefix>StagedProducts/Elevation/1m/Projects/</Prefix><NextContinuationToken>1YOiXfSU0z&amp;more</NextContinuationToken><KeyCount>3</KeyCount><MaxKeys>3</MaxKeys><Delimiter>/</Delimiter><IsTruncated>true</IsTruncated><CommonPrefixes><Prefix>StagedProducts/Elevation/1m/Projects/AL_11County_B23/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/</Prefix></CommonPrefixes><Contents><Key>StagedProducts/Elevation/1m/Projects/Thumbs.db</Key><Size>4096</Size></Contents></ListBucketResult>`;

describe('S3 listing', () => {
  it('separates CommonPrefixes from the echoed request Prefix', () => {
    // The trap: the response contains a top-level `<Prefix>` echoing the
    // request. Counting it as a project would put a non-existent
    // "" project in the index and probe URLs that can never resolve.
    const page = parseS3ListXml(REAL_LIST_XML);
    expect(page.prefixes).toEqual([
      'StagedProducts/Elevation/1m/Projects/AL_11County_B23/',
      'StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/',
    ]);
    expect(page.keys).toEqual(['StagedProducts/Elevation/1m/Projects/Thumbs.db']);
  });

  it('decodes XML entities in the continuation token', () => {
    // Continuation tokens are base64-ish and routinely contain characters S3
    // escapes. A token passed on still-escaped fetches page 2 forever.
    expect(parseS3ListXml(REAL_LIST_XML).nextContinuationToken).toBe('1YOiXfSU0z&more');
  });

  it('reports no continuation when the listing is complete', () => {
    const xml = REAL_LIST_XML.replace('<IsTruncated>true<', '<IsTruncated>false<');
    const page = parseS3ListXml(xml);
    expect(page.truncated).toBe(false);
    expect(page.nextContinuationToken).toBeUndefined();
  });

  it('degrades to an empty page on unparseable XML rather than inventing one', () => {
    // Direction of failure matters: an empty page reads downstream as "no 1 m
    // coverage", which falls back visibly. A partially-parsed page would read
    // as coverage that is not there.
    const page = parseS3ListXml('<html>403 Forbidden</html>');
    expect(page).toEqual({
      keys: [],
      prefixes: [],
      nextContinuationToken: undefined,
      truncated: false,
    });
  });

  it('builds a list URL with the parameters the bucket needs', () => {
    const url = s3ListUrl('https://b', 'p/', { delimiter: '/', maxKeys: 1000 });
    expect(url).toContain('list-type=2');
    expect(url).toContain('delimiter=%2F');
    expect(url).toContain('max-keys=1000');
  });

  it('follows continuation tokens to the end', async () => {
    const pages = [
      REAL_LIST_XML,
      REAL_LIST_XML.replace('<IsTruncated>true<', '<IsTruncated>false<').replace(
        'AL_11County_B23',
        'WY_FEMA_East_2019_D19',
      ),
    ];
    let n = 0;
    const projects = await listOneMeterProjects(async () => pages[n++]);
    expect(projects).toContain('KY_Statewide_2021_A21');
    expect(projects).toContain('WY_FEMA_East_2019_D19');
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Manifest parsing and index building
// ---------------------------------------------------------------------------

const KY_MANIFEST = [
  'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/TIFF/USGS_1M_16_x26y405_KY_Statewide_2021_A21.tif',
  'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/TIFF/USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif',
  'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/metadata/USGS_1M_16_x27y405_KY_Statewide_2021_A21.xml',
  '',
  'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/browse/Thumbs.db',
].join('\n');

describe('manifest parsing', () => {
  it('keeps only the TIFF tiles', () => {
    const entries = parseOneMeterManifest(KY_MANIFEST);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.x)).toEqual([26, 27]);
    // The .xml sidecar shares the tile's stem exactly; only the extension
    // distinguishes them, so an extension-blind parser doubles every cell.
    expect(entries.every((e) => e.project === 'KY_Statewide_2021_A21')).toBe(true);
  });

  it('tolerates CRLF and blank lines', () => {
    expect(parseOneMeterManifest(KY_MANIFEST.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });
});

describe('OneMeterIndex', () => {
  it('indexes zoned names precisely and unzoned names under a wildcard', () => {
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone: 16, x: 27, y: 405, project: 'KY_Statewide_2021_A21' },
      { stemId: 'one_meter', x: 47, y: 534, project: 'Elwha_River_LiDAR_2014_MOD2' },
    ]);
    expect(index.cellCount).toBe(2);
    const data = index.toData();
    expect(Object.keys(data.cells).sort()).toEqual(
      [cellKey(16, 27, 405), cellKey(undefined, 47, 534)].sort(),
    );
  });

  it('records each project once per cell even when it publishes variants', () => {
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone: 16, x: 27, y: 405, project: 'P' },
      { stemId: '1M_zone', zone: 16, x: 27, y: 405, project: 'P' },
    ]);
    expect(index.toData().cells[cellKey(16, 27, 405)]).toEqual([0]);
  });

  it('round-trips through its serialized form', () => {
    const original = OneMeterIndex.build(
      parseOneMeterManifest(KY_MANIFEST),
      '2026-01-01T00:00:00Z',
    );
    const restored = OneMeterIndex.fromData(JSON.parse(JSON.stringify(original.toData())));
    expect(restored.toData()).toEqual(original.toData());
    expect(restored.builtAtIso).toBe('2026-01-01T00:00:00Z');
  });

  it('refuses an index written by a future version rather than misreading it', () => {
    const data = OneMeterIndex.build([]).toData();
    expect(() => OneMeterIndex.fromData({ ...data, version: 2 as unknown as 1 })).toThrow(
      /version/,
    );
  });

  it('places a known Kentucky point in the cell its file name says', async () => {
    // Closed form: the cell index is floor(easting / 10 000), and `y` counts
    // the cell's NORTH edge, so it is floor(northing / 10 000) + 1.
    const lng = -85.6556;
    const lat = 37.9186;
    const zone = utmZoneForLongitude(lng);
    const u = lngLatToUtm(lng, lat, zone);
    const index = OneMeterIndex.build([
      {
        stemId: '1M_zone',
        zone,
        x: Math.floor(u.easting / 10000),
        y: Math.floor(u.northing / 10000) + 1,
        project: 'KY_Statewide_2021_A21',
      },
    ]);
    const candidates = index.candidatesAt(lng, lat);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].project).toBe('KY_Statewide_2021_A21');
    expect(candidates[0].zoneFromIndex).toBe(true);
  });

  it('searches neighbouring UTM zones, because projects cross zone boundaries', () => {
    // A project near a zone boundary publishes everything in ONE zone using
    // extended coordinates, so the point's own zone computes the wrong cell.
    // Measured: a Bernheim Forest point (zone 16) resolves to a project whose
    // other tiles are named zone 17.
    const lng = -84.05;
    const lat = 37.9;
    const home = utmZoneForLongitude(lng);
    const other = home + 1;
    const u = lngLatToUtm(lng, lat, other);
    const index = OneMeterIndex.build([
      {
        stemId: '1M_zone',
        zone: other,
        x: Math.floor(u.easting / 10000),
        y: Math.floor(u.northing / 10000) + 1,
        project: 'KY_CentralEast_A23',
      },
    ]);
    const candidates = index.candidatesAt(lng, lat);
    expect(candidates.map((c) => c.project)).toContain('KY_CentralEast_A23');
    expect(candidates.find((c) => c.project === 'KY_CentralEast_A23')?.zone).toBe(other);
  });

  it('orders zone-qualified candidates ahead of wildcard ones', () => {
    // Wildcard hits are same-numbered cells from anywhere in the country — a
    // Kentucky point really does collide with Colorado, Kansas and Virginia
    // projects (measured). They must be probed last.
    const lng = -83.6266;
    const lat = 37.8153;
    const zone = utmZoneForLongitude(lng);
    const u = lngLatToUtm(lng, lat, zone);
    const x = Math.floor(u.easting / 10000);
    const y = Math.floor(u.northing / 10000) + 1;
    const index = OneMeterIndex.build([
      { stemId: 'one_meter', x, y, project: 'CO_SanJuan_NF_2017' },
      { stemId: '1M_zone', zone, x, y, project: 'KY_CentralEast_A23' },
    ]);
    const candidates = index.candidatesAt(lng, lat);
    expect(candidates[0].project).toBe('KY_CentralEast_A23');
    expect(candidates[0].stems).toEqual([`USGS_1M_${zone}_x${x}y${y}`]);
    expect(candidates[1].project).toBe('CO_SanJuan_NF_2017');
    // A wildcard hit could be either unzoned convention, so both are offered.
    expect(candidates[1].stems).toEqual([`USGS_one_meter_x${x}y${y}`, `USGS_1m_x${x}y${y}`]);
  });

  it('returns nothing where the index has no cell', () => {
    expect(OneMeterIndex.build([]).candidatesAt(-100, 40)).toEqual([]);
  });

  /**
   * The index is built by ~960 concurrent manifest reads, so its project order
   * is completion order and differs run to run. 31% of cells are claimed by
   * more than one acquisition (measured), so without a stable ordering the same
   * ground resolves to a different survey after a restart, and two adjacent map
   * tiles can come from two different surveys — a seam through a hillside that
   * a user could never account for.
   */
  it('orders candidates deterministically regardless of index build order', () => {
    const lng = -83.6266;
    const lat = 37.8153;
    const zone = utmZoneForLongitude(lng);
    const u = lngLatToUtm(lng, lat, zone);
    const x = Math.floor(u.easting / 10000);
    const y = Math.floor(u.northing / 10000) + 1;
    const names = ['KY_WestCentral_2017_C19', 'KY_CentralEast_A23', 'KY_Eastern_2019_A19'];
    const order = (ns: string[]): string[] =>
      OneMeterIndex.build(
        ns.map((project) => ({ stemId: '1M_zone' as const, zone, x, y, project })),
      )
        .candidatesAt(lng, lat)
        .map((c) => c.project);

    const forward = order(names);
    const reversed = order([...names].reverse());
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([...names].sort());
  });

  it('builds a national index from listing plus manifests, skipping 404s', async () => {
    // 31 of 959 project manifests 404 in the live bucket. Losing one project
    // costs its coverage; failing the build costs all of it.
    const listXml = REAL_LIST_XML.replace('<IsTruncated>true<', '<IsTruncated>false<');
    const index = await buildOneMeterIndex(
      async (url) => {
        if (url.includes('list-type=2')) return listXml;
        if (url.includes('KY_Statewide_2021_A21')) return KY_MANIFEST;
        throw new Error('404');
      },
      { concurrency: 2 },
    );
    expect(index.projects).toEqual(['KY_Statewide_2021_A21']);
    expect(index.cellCount).toBe(2);
  });

  it('subsets to a bounding box small enough to store per property', () => {
    const lng = -85.6556;
    const lat = 37.9186;
    const zone = utmZoneForLongitude(lng);
    const u = lngLatToUtm(lng, lat, zone);
    const near = {
      stemId: '1M_zone' as const,
      zone,
      x: Math.floor(u.easting / 10000),
      y: Math.floor(u.northing / 10000) + 1,
      project: 'KY_Statewide_2021_A21',
    };
    const index = OneMeterIndex.build([
      near,
      // 1000 km east — must not survive the subset.
      { ...near, x: near.x + 100, project: 'VA_Sandy_2014' },
    ]);
    const subset = index.subsetForBBox({
      west: lng - 0.01,
      east: lng + 0.01,
      south: lat - 0.01,
      north: lat + 0.01,
    });
    expect(subset.projects).toEqual(['KY_Statewide_2021_A21']);
    expect(subset.candidatesAt(lng, lat).map((c) => c.project)).toEqual(['KY_Statewide_2021_A21']);
  });

  it('pads the subset by a cell so a property straddling a boundary keeps its neighbour', () => {
    // The 10 km grid has nothing to do with property lines, so straddling is
    // the common case, and a halo needs the neighbouring tile.
    const lng = -85.6556;
    const lat = 37.9186;
    const zone = utmZoneForLongitude(lng);
    const u = lngLatToUtm(lng, lat, zone);
    const x = Math.floor(u.easting / 10000);
    const y = Math.floor(u.northing / 10000) + 1;
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone, x: x + 1, y, project: 'NEIGHBOUR' },
    ]);
    const subset = index.subsetForBBox({
      west: lng - 0.001,
      east: lng + 0.001,
      south: lat - 0.001,
      north: lat + 0.001,
    });
    expect(subset.projects).toEqual(['NEIGHBOUR']);
  });
});

// ---------------------------------------------------------------------------
// The verification gate
// ---------------------------------------------------------------------------

/**
 * A real 1 m-like COG in a given UTM zone, 64x64 cells at 1 m, whose north-west
 * corner is placed on a 10 km cell boundary exactly as USGS tiles are.
 *
 * `fill` of `NODATA` produces a file that opens, is georeferenced, contains the
 * point — and has nothing measured there. That is the Wyoming case: three
 * projects claimed the cell and only the third had data.
 */
function oneMeterLikeCog(zone: number, x: number, y: number, fill: number): Uint8Array {
  const w = 64;
  const h = 64;
  return writeSyntheticTiff({
    width: w,
    height: h,
    tileWidth: 32,
    tileHeight: 32,
    samples: new Array(w * h).fill(fill),
    pixelScale: [1, 1, 0],
    // North-west corner of the 10 km cell: easting x*10000, northing y*10000.
    tiePoint: [0, 0, 0, x * 10000, y * 10000, 0],
    // Projected (GTModelType 1), PixelIsArea, NAD83 / UTM north.
    geoKeys: [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, nad83UtmEpsg(zone)],
    noData: String(NODATA),
  });
}

function bytesReader(bytes: Uint8Array) {
  return async (start: number, end: number): Promise<Uint8Array> =>
    bytes.subarray(start, Math.min(end + 1, bytes.length));
}

describe('resolveOneMeterTile — the verification gate', () => {
  const zone = 16;
  // A point a few metres inside the synthetic tile's north-west corner.
  const cellX = 43;
  const cellY = 420;
  const probe = (() => {
    const reader = CogReader.open(bytesReader(oneMeterLikeCog(zone, cellX, cellY, 250)));
    return reader;
  })();

  /** lng/lat of a point 20 m east and 20 m south of the cell's NW corner. */
  async function pointInsideCell(): Promise<{ lng: number; lat: number }> {
    const reader = await probe;
    return reader.lngLatFromModel(cellX * 10000 + 20, cellY * 10000 - 20);
  }

  it('accepts a candidate whose file covers the point and has data there', async () => {
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'GOOD' },
    ]);
    const resolved = await resolveOneMeterTile(index, lng, lat, async () =>
      CogReader.open(bytesReader(oneMeterLikeCog(zone, cellX, cellY, 250))),
    );
    expect(resolved?.project).toBe('GOOD');
    expect(resolved?.zone).toBe(zone);
    expect(resolved?.sampleMeters).toBeCloseTo(250, 6);
  });

  /**
   * The Wyoming case, reproduced. Three projects claim the cell; the first two
   * are wholly NODATA there and only the third has ground. Stopping at the
   * first file that merely *opens* renders a void as though it were terrain.
   */
  it('skips candidates that open and contain the point but have no data there', async () => {
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'EMPTY_A' },
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'EMPTY_B' },
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'HAS_DATA' },
    ]);
    const resolved = await resolveOneMeterTile(index, lng, lat, async (url) =>
      CogReader.open(
        bytesReader(
          oneMeterLikeCog(zone, cellX, cellY, url.includes('HAS_DATA') ? 2053.376 : NODATA),
        ),
      ),
    );
    expect(resolved?.project).toBe('HAS_DATA');
    expect(resolved?.sampleMeters).toBeCloseTo(2053.376, 3);
    expect(resolved?.probes).toBe(3);
  });

  /**
   * The wildcard collision, reproduced. 574 of 959 projects put no zone in
   * their file names, so cell `x26y419` in Kentucky collides with the
   * identically-numbered cell in Colorado, Kansas and Virginia. Only the
   * opened file's own georeferencing can tell them apart.
   */
  it('rejects a same-numbered cell from a different UTM zone', async () => {
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build([
      { stemId: 'one_meter', x: cellX, y: cellY, project: 'WRONG_ZONE' },
    ]);
    const resolved = await resolveOneMeterTile(index, lng, lat, async () =>
      // Same cell numbers, zone 13 — a real file, thousands of km away.
      CogReader.open(bytesReader(oneMeterLikeCog(13, cellX, cellY, 2100))),
    );
    expect(resolved).toBeNull();
  });

  it('rejects a geographic raster, which a 1 m product never is', async () => {
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'GEOGRAPHIC' },
    ]);
    const geographic = writeSyntheticTiff({
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      samples: new Array(32 * 32).fill(300),
      pixelScale: [0.001, 0.001, 0],
      tiePoint: [0, 0, 0, lng - 0.005, lat + 0.005, 0],
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
    });
    const resolved = await resolveOneMeterTile(index, lng, lat, async () =>
      CogReader.open(bytesReader(geographic)),
    );
    expect(resolved).toBeNull();
  });

  it('treats a 404 on one stem as ordinary and tries the next', async () => {
    const { lng, lat } = await pointInsideCell();
    // A wildcard hit offers `USGS_one_meter_...` then `USGS_1m_...`. The first
    // 404s for 59 of the 574 unzoned projects.
    const index = OneMeterIndex.build([
      { stemId: 'one_meter', x: cellX, y: cellY, project: 'LEGACY' },
    ]);
    const resolved = await resolveOneMeterTile(index, lng, lat, async (url) => {
      if (url.includes('USGS_one_meter_')) throw new Error('HTTP 404');
      return CogReader.open(bytesReader(oneMeterLikeCog(zone, cellX, cellY, 191.779)));
    });
    expect(resolved?.project).toBe('LEGACY');
    expect(resolved?.url).toContain('USGS_1m_');
  });

  it('answers null — never a fallback — where nothing resolves', async () => {
    // "No 1 m data here" is a real, correct answer (measured at Elwha River,
    // WA). It must reach the caller as `null` so the caller can fall back
    // visibly and labelled, rather than being papered over here.
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build([
      { stemId: '1M_zone', zone, x: cellX, y: cellY, project: 'GONE' },
    ]);
    const resolved = await resolveOneMeterTile(index, lng, lat, async () => {
      throw new Error('HTTP 404');
    });
    expect(resolved).toBeNull();
  });

  it('caps the number of files it will open', async () => {
    const { lng, lat } = await pointInsideCell();
    const index = OneMeterIndex.build(
      Array.from({ length: 30 }, (_, i) => ({
        stemId: '1M_zone' as const,
        zone,
        x: cellX,
        y: cellY,
        project: `P${i}`,
      })),
    );
    let opened = 0;
    const resolved = await resolveOneMeterTile(
      index,
      lng,
      lat,
      async () => {
        opened++;
        return CogReader.open(bytesReader(oneMeterLikeCog(zone, cellX, cellY, NODATA)));
      },
      { maxProbes: 5 },
    );
    expect(resolved).toBeNull();
    expect(opened).toBe(5);
  });
});
