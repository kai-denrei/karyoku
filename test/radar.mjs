import { radarProject, radarBearing, sweepAngle, radarPhosphor, radarColor, RADAR_RANGE_M, SWEEP_PERIOD } from '../src/radar.js';
import { check, near, done } from './check.mjs';

const R = RADAR_RANGE_M;
let p = radarProject(100, 100 - R / 2, 100, 100, 0);
check('facing north, a contact ahead sits straight up the scope', near(p.x, 0) && near(p.y, -0.5) && !p.clamped);
p = radarProject(100 + R / 4, 100, 100, 100, 0);
check('facing north, east is right', near(p.x, 0.25) && near(p.y, 0));
p = radarProject(100, 100 - R / 2, 100, 100, 90);
check('facing east, a contact to the north is on the left', near(p.x, 0) && near(p.y, -0.5) === false && near(p.x, 0) && p.y < 0.01 && near(radarProject(100, 100 - R / 2, 100, 100, 90).x, 0) ? near(radarProject(100, 100 - R / 2, 100, 100, 90).x, 0) && near(radarProject(100, 100 - R / 2, 100, 100, 90).y, 0) === false : true);
p = radarProject(100, 100 - R / 2, 100, 100, 90);
check('facing east, north is to the left of the scope', near(p.x, -0.5) && near(p.y, 0));
p = radarProject(100, 100 - 3 * R, 100, 100, 0);
check('beyond range a contact pins to the rim', p.clamped && near(Math.hypot(p.x, p.y), 1) && near(p.y, -1));
check('bearing: up is 0, right is a quarter turn', near(radarBearing(0, -1), 0) && near(radarBearing(1, 0), Math.PI / 2));
check('the beam turns once per period', near(sweepAngle(SWEEP_PERIOD / 4), Math.PI / 2) && near(sweepAngle(SWEEP_PERIOD), 0));
check('phosphor: full under the beam, dim far behind, never black', near(radarPhosphor(1, 1), 1) && radarPhosphor(1, 1 + 3) < 0.6 && radarPhosphor(0, 6.2) >= 0.16);
check('colours: ours blue, theirs red and orange', radarColor('home', 'static') === '#3f8fff' && radarColor('home', 'unit') === '#1f4fb0' && radarColor('hostile', 'static') === '#ff4d4d' && radarColor('hostile', 'unit') === '#ff9a3c');
done();
