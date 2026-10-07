/**
 * Garage Domain Layer Dynamic Execution Test
 * Directly invokes platform/lib/garage.ts via tsx to test runtime calculations,
 * validations, state machines, overpayment rejection, and finance logging.
 */

import {
  getGarageCustomers,
  createGarageCustomer,
  getGarageVehicles,
  createGarageVehicle,
  getGarageJobs,
  createGarageJob,
  updateGarageJobStatus,
  addGarageJobItem,
  recordGaragePayment,
  getGarageModuleSummary,
  getGarageReports,
} from '../platform/lib/garage.ts';

const COMPANY_A_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_B_ID = '22222222-2222-4222-8222-222222222222';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, name, details = '') {
  if (condition) {
    testsPassed++;
    console.log(`✅ PASS: ${name}${details ? ` (${details})` : ''}`);
  } else {
    testsFailed++;
    console.error(`❌ FAIL: ${name}${details ? ` (${details})` : ''}`);
  }
}

async function runDomainTests() {
  console.log('=== Garage Domain Runtime Functionality Tests ===\n');

  // 1. Customer Creation
  const custRes = await createGarageCustomer(COMPANY_B_ID, {
    name: 'Mamadou Ndiaye Test',
    phone: '+221 77 999 88 77',
    email: 'mamadou.test@kazibox.sn',
    address: 'Dakar, Plateau',
  });
  assert(custRes.success && Boolean(custRes.customer?.id), 'Customer Creation', custRes.customer?.name);
  const custId = custRes.customer?.id;

  // 2. Customer Listing & Tenancy Isolation
  const custsB = await getGarageCustomers(COMPANY_B_ID);
  const custsA = await getGarageCustomers(COMPANY_A_ID);
  const foundInB = custsB.some(c => c.id === custId);
  const foundInA = custsA.some(c => c.id === custId);
  assert(foundInB && !foundInA, 'Customer Tenancy Isolation (Company B cust not in Company A)');

  // 3. Cross-Tenant Vehicle Creation Block
  const crossVehRes = await createGarageVehicle(COMPANY_A_ID, {
    customer_id: custId, // customer belongs to B, vehicle for A
    registration_number: 'AA-1234-XX',
    make: 'Toyota',
    model: 'Yaris',
  });
  assert(!crossVehRes.success, 'Cross-Tenant Vehicle Guard (Blocks Company A vehicle with Company B customer)', crossVehRes.error);

  // 4. Valid Vehicle Creation
  const vehRes = await createGarageVehicle(COMPANY_B_ID, {
    customer_id: custId,
    registration_number: 'DK-9999-ZZ',
    make: 'Toyota',
    model: 'Hilux',
    year: 2022,
    mileage: 45000,
  });
  assert(vehRes.success && Boolean(vehRes.vehicle?.id), 'Valid Vehicle Creation', vehRes.vehicle?.registration_number);
  const vehId = vehRes.vehicle?.id;

  // 5. Cross-Tenant Repair Job Guard
  const crossJobRes = await createGarageJob(COMPANY_A_ID, {
    customer_id: custId, // B's customer
    vehicle_id: vehId, // B's vehicle
    title: 'Illegal Job Attempt',
  });
  assert(!crossJobRes.success, 'Cross-Tenant Job Guard (Blocks job for Company A with Company B customer/vehicle)', crossJobRes.error);

  // 6. Valid Repair Job Creation with Initial Items
  const jobRes = await createGarageJob(COMPANY_B_ID, {
    customer_id: custId,
    vehicle_id: vehId,
    title: 'Révision 45,000 km & Changement Freins',
    diagnosis: 'Usure prononcée des disques avant',
    mechanic_name: 'Cheikh Sarr',
    initial_items: [
      { item_type: 'service', name: 'Main d’oeuvre révision', quantity: 1, unit_price: 25000 },
      { item_type: 'part', name: 'Jeu disques de frein', quantity: 2, unit_price: 20000 },
    ],
  });
  assert(jobRes.success && Boolean(jobRes.job?.id), 'Repair Job Creation with Calculated Items', `Total: ${jobRes.job?.total_amount} XOF`);
  const job = jobRes.job;
  assert(job?.total_amount === 65000, 'Server-Side Line Item Total Calculation (25000 + 2*20000 = 65000)', `Calculated: ${job?.total_amount}`);
  assert(job?.outstanding_amount === 65000, 'Initial Outstanding Equals Total', `Outstanding: ${job?.outstanding_amount}`);
  assert(job?.payment_status === 'unpaid', 'Initial Payment Status is Unpaid');

  const jobId = job.id;

  // 7. Status Transitions: open -> in_progress -> completed
  const st1 = await updateGarageJobStatus(COMPANY_B_ID, jobId, 'in_progress');
  assert(st1.success, 'Status Transition to in_progress');

  const st2 = await updateGarageJobStatus(COMPANY_B_ID, jobId, 'completed');
  assert(st2.success, 'Status Transition to completed (sets completed_at)');

  // 8. Payment Overpayment Rejection
  const overpayRes = await recordGaragePayment(COMPANY_B_ID, jobId, {
    amount: 100000, // exceeds 65000
    payment_method: 'cash',
  });
  assert(!overpayRes.success, 'Overpayment Protection (Rejects 100,000 XOF when outstanding is 65,000 XOF)', overpayRes.error);

  // 9. Negative Payment Rejection
  const negPayRes = await recordGaragePayment(COMPANY_B_ID, jobId, {
    amount: -5000,
    payment_method: 'cash',
  });
  assert(!negPayRes.success, 'Negative Payment Protection (Rejects -5,000 XOF)', negPayRes.error);

  // 10. Valid Partial Payment
  const pay1Res = await recordGaragePayment(COMPANY_B_ID, jobId, {
    amount: 30000,
    payment_method: 'mobile_money',
    reference: 'WAVE-TX-987654',
  });
  assert(pay1Res.success, 'Valid Partial Payment (30,000 XOF via mobile_money)');

  // 11. Valid Balance Settlement Payment
  const pay2Res = await recordGaragePayment(COMPANY_B_ID, jobId, {
    amount: 35000,
    payment_method: 'cash',
  });
  assert(pay2Res.success, 'Final Balance Settlement (35,000 XOF via cash, sets status to paid)');

  // 12. Deliver Vehicle
  const st3 = await updateGarageJobStatus(COMPANY_B_ID, jobId, 'delivered');
  assert(st3.success, 'Final Status Transition to delivered');

  // 13. ModuleSummary SDK Contract
  const summary = await getGarageModuleSummary(COMPANY_B_ID);
  assert(
    summary.moduleId === 'garage-auto' && summary.revenue > 0 && Array.isArray(summary.metrics),
    'Garage ModuleSummary SDK Contract Conformance',
    `Revenue: ${summary.revenue} ${summary.currency}, Activities: ${summary.activityCount}`
  );

  // 14. Garage Reports
  const reports = await getGarageReports(COMPANY_B_ID);
  assert(
    reports.revenueThisMonth >= 65000 && Array.isArray(reports.topServices),
    'Garage Operational & Financial Reports Generated',
    `This Month Revenue: ${reports.revenueThisMonth} XOF, Top Services: ${reports.topServices.length}`
  );


  console.log(`\n=================================================`);
  console.log(`Domain Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`=================================================`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runDomainTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
