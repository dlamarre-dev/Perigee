import { Astronomy } from './astronomy';
import { normalize, type Vec3 } from './vec3';

/**
 * Unit vector from the Earth's centre towards the Sun, in the J2000 equatorial frame (EQJ),
 * corrected for aberration (apparent direction). Used for lighting and the day/night terminator.
 */
export function sunDirectionEci(date: Date): Vec3 {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, date, true);
  return normalize([v.x, v.y, v.z]);
}
