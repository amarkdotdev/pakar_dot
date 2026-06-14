const assert = require('assert');
const { computeStatus, cityStates } = require('./server');

const city = 'מעלה אדומים';

function reset() {
  cityStates.clear();
}

reset();
let status = computeStatus(city, { cat: 1, title: 'ירי רקטות וטילים', data: [city] }, []);
assert.equal(status.status, 'red');
assert.equal(status.reason, 'active_alert');

status = computeStatus(city, null, []);
assert.equal(status.status, 'red');
assert.equal(status.reason, 'waiting_oref_all_clear');

status = computeStatus(city, null, [
  {
    alertDate: new Date(Date.now() + 1000).toISOString(),
    category: 14,
    title: 'האירוע הסתיים, השוהים במרחב המוגן יכולים לצאת',
    data: city,
  },
]);
assert.equal(status.status, 'green');
assert.equal(status.reason, 'oref_all_clear');

reset();
status = computeStatus(city, { cat: 14, title: 'התקרבו למרחב מוגן', data: [city] }, []);
assert.equal(status.status, 'yellow');
assert.equal(status.reason, 'oref_warning');

console.log('status flow ok');
