/**
 * fitsReader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses Kepler FITS light curve files entirely in the browser.
 * Supports KIC .fits files (LC — long cadence, 1 reading per ~30 min).
 *
 * Returns: { time, flux, fluxErr, header }
 *
 * FITS format primer:
 *   - Fixed 2880-byte "blocks"
 *   - First block(s): Primary HDU header (ASCII key=value cards, 80 chars each)
 *   - Next HDU: Binary FITS table with TIME, PDCSAP_FLUX, PDCSAP_FLUX_ERR columns
 *   - Stellar parameters embedded in header (TEFF, LOGG, RADIUS)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BLOCK_SIZE = 2880;
const CARD_SIZE  = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Kepler FITS file from an ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{
 *   time: Float64Array,
 *   flux: Float64Array,
 *   fluxErr: Float64Array,
 *   header: Object,
 *   meta: Object
 * }}
 */
export function parseFITS(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // ── Parse Primary HDU header (we only need stellar params from here)
  const primaryHeader = parseHeader(bytes, offset);
  offset += primaryHeader._bytesConsumed;
  // Primary HDU has no data extension for Kepler LC files, skip any data
  const primaryNAXIS = primaryHeader["NAXIS"] || 0;
  if (primaryNAXIS > 0) {
    const dataSize = computeDataSize(primaryHeader);
    offset += Math.ceil(dataSize / BLOCK_SIZE) * BLOCK_SIZE;
  }

  // ── Parse extension HDU headers until we find the LIGHTCURVE table
  let lightCurveData = null;
  let attempts = 0;

  while (offset < bytes.length && attempts < 10) {
    attempts++;
    if (offset + CARD_SIZE > bytes.length) break;

    const extHeader = parseHeader(bytes, offset);
    offset += extHeader._bytesConsumed;

    const extName = (extHeader["EXTNAME"] || "").trim().toUpperCase();

    if (extName === "LIGHTCURVE" || extName === "1") {
      lightCurveData = parseBinaryTable(bytes, offset, extHeader);
      break;
    }

    // Skip this extension's data
    const dataSize = computeDataSize(extHeader);
    offset += Math.ceil(dataSize / BLOCK_SIZE) * BLOCK_SIZE;
  }

  if (!lightCurveData) {
    throw new Error(
      "Could not find LIGHTCURVE extension in FITS file. " +
      "Make sure you are uploading a Kepler LC (long cadence) FITS file."
    );
  }

  const { time, flux, fluxErr } = lightCurveData;

  // ── Extract stellar parameters from primary header
  const stellarParams = extractStellarParams(primaryHeader);

  // ── Basic metadata
  const meta = {
    kepid:      primaryHeader["KEPLERID"] || primaryHeader["OBJECT"] || "Unknown",
    quarter:    primaryHeader["QUARTER"]  || null,
    campaign:   primaryHeader["CAMPAIGN"] || null,
    cadence:    primaryHeader["OBSMODE"]  || "long cadence",
    nPoints:    time.length,
    timeStart:  Math.min(...time.filter(isFinite)),
    timeEnd:    Math.max(...time.filter(isFinite)),
    ...stellarParams,
  };

  return { time, flux, fluxErr, header: primaryHeader, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Header parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseHeader(bytes, startOffset) {
  const header = {};
  let offset = startOffset;
  let ended  = false;
  let bytesConsumed = 0;

  while (!ended) {
    // Each block is 2880 bytes = 36 cards of 80 bytes
    for (let card = 0; card < 36; card++) {
      if (offset + CARD_SIZE > bytes.length) { ended = true; break; }

      const cardBytes = bytes.slice(offset, offset + CARD_SIZE);
      offset += CARD_SIZE;
      bytesConsumed += CARD_SIZE;

      const cardStr = bytesToAscii(cardBytes);
      const keyword = cardStr.slice(0, 8).trimEnd();

      if (keyword === "END") { ended = true; break; }
      if (keyword === "" || keyword.startsWith("COMMENT") || keyword.startsWith("HISTORY")) continue;

      // Value is after "= " in columns 9-80
      if (cardStr[8] === "=") {
        const valueComment = cardStr.slice(10).trim();
        header[keyword] = parseCardValue(valueComment);
      }
    }

    // Round up to block boundary
    const remainder = bytesConsumed % BLOCK_SIZE;
    if (ended && remainder !== 0) {
      const padding = BLOCK_SIZE - remainder;
      offset += padding;
      bytesConsumed += padding;
    }
  }

  header["_bytesConsumed"] = bytesConsumed;
  return header;
}

function parseCardValue(valueComment) {
  const s = valueComment.split("/")[0].trim();
  if (s.startsWith("'")) {
    return s.replace(/'/g, "").trim();
  }
  if (s === "T") return true;
  if (s === "F") return false;
  const n = Number(s);
  return isNaN(n) ? s : n;
}

function bytesToAscii(bytes) {
  return String.fromCharCode(...bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary table parsing — extracts TIME, PDCSAP_FLUX, PDCSAP_FLUX_ERR columns
// ─────────────────────────────────────────────────────────────────────────────

function parseBinaryTable(bytes, dataOffset, header) {
  const nRows  = header["NAXIS2"] || 0;
  const nCols  = header["TFIELDS"] || 0;

  if (nRows === 0 || nCols === 0) {
    throw new Error("Empty FITS binary table");
  }

  // Build column descriptors from TTYPEn / TFORMn keywords
  const cols = [];
  let rowWidth = 0;

  for (let i = 1; i <= nCols; i++) {
    const name   = (header[`TTYPE${i}`] || "").trim().toUpperCase();
    const form   = (header[`TFORM${i}`] || "").trim().toUpperCase();
    const width  = tformWidth(form);
    const kind   = tformKind(form);
    cols.push({ name, form, width, kind, byteOffset: rowWidth });
    rowWidth += width;
  }

  // Find the columns we care about
  const timeCol     = cols.find(c => c.name === "TIME"           );
  const fluxCol     = cols.find(c => c.name === "PDCSAP_FLUX"    );
  const fluxErrCol  = cols.find(c => c.name === "PDCSAP_FLUX_ERR");

  if (!timeCol || !fluxCol) {
    // Fallback: try SAP_FLUX if PDCSAP not present (older files)
    const sapFluxCol = cols.find(c => c.name === "SAP_FLUX");
    if (!sapFluxCol) {
      throw new Error(
        `Could not find TIME or PDCSAP_FLUX columns in FITS table.\n` +
        `Found columns: ${cols.map(c => c.name).join(", ")}`
      );
    }
  }

  // Read the data
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset);
  const time    = new Float64Array(nRows);
  const flux    = new Float64Array(nRows);
  const fluxErr = new Float64Array(nRows);

  const usedFluxCol    = fluxCol || cols.find(c => c.name === "SAP_FLUX");
  const usedFluxErrCol = fluxErrCol || cols.find(c => c.name === "SAP_FLUX_ERR");

  for (let row = 0; row < nRows; row++) {
    const rowBase = row * rowWidth;

    if (timeCol) {
      time[row] = readValue(view, rowBase + timeCol.byteOffset, timeCol.kind);
    }
    if (usedFluxCol) {
      flux[row] = readValue(view, rowBase + usedFluxCol.byteOffset, usedFluxCol.kind);
    }
    if (usedFluxErrCol) {
      fluxErr[row] = readValue(view, rowBase + usedFluxErrCol.byteOffset, usedFluxErrCol.kind);
    }
  }

  return { time, flux, fluxErr };
}

// FITS TFORM codes → byte widths
function tformWidth(form) {
  const match = form.match(/^(\d*)([A-Z])/);
  if (!match) return 4;
  const repeat = parseInt(match[1] || "1");
  const type   = match[2];
  const sizes  = { E: 4, D: 8, J: 4, I: 2, K: 8, L: 1, B: 1, A: 1, X: 1 };
  return repeat * (sizes[type] || 4);
}

function tformKind(form) {
  const m = form.match(/[A-Z]$/);
  return m ? m[0] : "E";
}

function readValue(view, byteOffset, kind) {
  try {
    switch (kind) {
      case "D": return view.getFloat64(byteOffset, false); // big-endian
      case "E": return view.getFloat32(byteOffset, false);
      case "J": return view.getInt32(byteOffset, false);
      case "I": return view.getInt16(byteOffset, false);
      case "K": return Number(view.getBigInt64(byteOffset, false));
      default:  return view.getFloat32(byteOffset, false);
    }
  } catch {
    return NaN;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stellar parameter extraction from header
// ─────────────────────────────────────────────────────────────────────────────

function extractStellarParams(header) {
  return {
    stellarTeff:   header["TEFF"]    || header["TEFF_KIC"]    || null, // K
    stellarLogg:   header["LOGG"]    || header["LOGG_KIC"]    || null, // dex
    stellarRadius: header["RADIUS"]  || header["RADIUS_KIC"]  || null, // R_sun
    stellarMass:   header["GMASS"]   || header["MASS_KIC"]    || null, // M_sun
    stellarFeh:    header["FEH"]     || header["FEH_KIC"]     || null, // [Fe/H]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeDataSize(header) {
  const naxis  = header["NAXIS"]  || 0;
  const bitpix = Math.abs(header["BITPIX"] || 8);
  let size = bitpix / 8;
  for (let i = 1; i <= naxis; i++) {
    size *= header[`NAXIS${i}`] || 0;
  }
  const pcount = header["PCOUNT"] || 0;
  const gcount = header["GCOUNT"] || 1;
  return gcount * (pcount + size);
}
