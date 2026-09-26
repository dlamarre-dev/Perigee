/** Physical and time constants. All lengths in km, all angles in rad. */

/** WGS84 equatorial radius. Flattening is ignored for rendering in M0. */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;

/** Astronomical unit (IAU 2012). */
export const AU_KM = 149_597_870.7;

export const J2000_JD = 2_451_545.0;
/** Julian date of the Unix epoch (1970-01-01T00:00:00Z). */
export const UNIX_EPOCH_JD = 2_440_587.5;

export const MS_PER_DAY = 86_400_000;
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_JULIAN_CENTURY = 36_525;

export const TWO_PI = 2 * Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
