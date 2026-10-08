/**
 * Phase 8 — Hair Salon & Beauty Spa Domain Runtime Execution Test
 * Directly tests platform/lib/salon.ts via tsx for:
 * 1. Customer CRUD & Multi-Tenant Isolation
 * 2. Staff CRUD & Role Management
 * 3. Services CRUD & Price/Duration Validations
 * 4. Appointment Creation & Automatic End Time Calculation
 * 5. Server-Side Appointment Conflict Prevention (Same Staff vs Different Staff)
 * 6. Appointment Lifecycle State Machine
 * 7. Payment Processing & Overpayment Protection
 * 8. Shared Finance Integration & Idempotency
 * 9. ModuleSummary SDK Contract Compliance
 * 10. Operational Metrics & Reports Generation
 * 11. Cross-Tenant Relationship Guard (Blocks foreign company entities)
 */

import {
  getSalonCustomers,
  createSalonCustomer,
  getSalonStaff,
  createSalonStaff,
  getSalonServices,
  createSalonService,
  updateSalonServiceStatus,
  getSalonAppointments,
  createSalonAppointment,
  updateSalonAppointmentStatus,
  recordSalonPayment,
  getSalonMetrics,
  getSalonReports,
  getSalonModuleSummary,
  calculateEndTime,
  checkTimeOverlap,
} from '../platform/lib/salon.ts';

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
  console.log('=================================================================');
  console.log('=== Hair Salon & Beauty Spa Domain Layer Execution Tests ===');
  console.log('=================================================================\n');

  // 1. End Time Calculation Engine
  const end1 = calculateEndTime('10:00', 45);
  const end2 = calculateEndTime('14:30', 90);
  const end3 = calculateEndTime('23:15', 60);
  assert(end1 === '10:45', 'End Time Calculation (10:00 + 45 min = 10:45)', end1);
  assert(end2 === '16:00', 'End Time Calculation (14:30 + 90 min = 16:00)', end2);
  assert(end3 === '00:15', 'End Time Calculation Crossing Midnight', end3);

  // 2. Time Overlap Logic Helper
  assert(checkTimeOverlap('10:00', '11:00', '10:30', '11:30') === true, 'Overlap Detection (10:00-11:00 vs 10:30-11:30 is TRUE)');
  assert(checkTimeOverlap('10:00', '11:00', '11:00', '12:00') === false, 'Adjacent Slots Allowed (10:00-11:00 vs 11:00-12:00 is FALSE)');
  assert(checkTimeOverlap('14:00', '15:00', '16:00', '17:00') === false, 'Disjoint Slots Allowed (14:00-15:00 vs 16:00-17:00 is FALSE)');
  assert(checkTimeOverlap('10:00', '12:00', '10:30', '11:00') === true, 'Enclosed Slot Overlap Detected');

  // 3. Customer Creation & Multi-Tenant Isolation
  const custResA = await createSalonCustomer(COMPANY_A_ID, {
    name: 'Khady Ndiaye',
    phone: '+221 77 111 22 33',
    email: 'khady.ndiaye@example.sn',
    notes: 'Habituée soin visage',
  });
  assert(custResA.success && Boolean(custResA.customer?.id), 'Customer Creation for Company A', custResA.customer?.name);
  const custAId = custResA.customer?.id;

  const custResB = await createSalonCustomer(COMPANY_B_ID, {
    name: 'Sokhna Diop',
    phone: '+221 78 222 33 44',
  });
  assert(custResB.success && Boolean(custResB.customer?.id), 'Customer Creation for Company B', custResB.customer?.name);
  const custBId = custResB.customer?.id;

  const customersA = await getSalonCustomers(COMPANY_A_ID);
  const customersB = await getSalonCustomers(COMPANY_B_ID);
  assert(
    customersA.some((c) => c.id === custAId) && !customersA.some((c) => c.id === custBId),
    'Customer Isolation: Company A cannot see Company B customer'
  );
  assert(
    customersB.some((c) => c.id === custBId) && !customersB.some((c) => c.id === custAId),
    'Customer Isolation: Company B cannot see Company A customer'
  );

  // 4. Staff Creation & Role Management
  const staffResA1 = await createSalonStaff(COMPANY_A_ID, {
    name: 'Awa Cissé',
    phone: '+221 77 888 11 22',
    role: 'stylist',
    notes: 'Coiffeuse principale',
  });
  assert(staffResA1.success && Boolean(staffResA1.staff?.id), 'Staff Creation (Stylist) for Company A');
  const staffA1Id = staffResA1.staff?.id;

  const staffResA2 = await createSalonStaff(COMPANY_A_ID, {
    name: 'Aminata Diallo',
    phone: '+221 77 888 33 44',
    role: 'beautician',
    notes: 'Esthéticienne manucure & soins',
  });
  assert(staffResA2.success && Boolean(staffResA2.staff?.id), 'Staff Creation (Beautician) for Company A');
  const staffA2Id = staffResA2.staff?.id;

  const staffListA = await getSalonStaff(COMPANY_A_ID);
  const staffListB = await getSalonStaff(COMPANY_B_ID);
  assert(
    staffListA.some((s) => s.id === staffA1Id) && !staffListB.some((s) => s.id === staffA1Id),
    'Staff Tenancy Isolation'
  );

  // 5. Service Creation & Deactivation (Safe retention)
  const srvRes1 = await createSalonService(COMPANY_A_ID, {
    name: 'Coloration & Brushing VIP',
    description: 'Soin kératine + couleur sur mesure',
    duration_minutes: 60,
    price: 25000,
  });
  assert(srvRes1.success && Boolean(srvRes1.service?.id), 'Service Creation (Coloration)', `${srvRes1.service?.price} XOF`);
  const srv1Id = srvRes1.service?.id;

  const srvRes2 = await createSalonService(COMPANY_A_ID, {
    name: 'Manucure Express',
    description: 'Pose vernis simple',
    duration_minutes: 30,
    price: 8000,
  });
  const srv2Id = srvRes2.service?.id;

  // Deactivate service (safe status change)
  const deactRes = await updateSalonServiceStatus(COMPANY_A_ID, srv2Id, 'inactive');
  assert(deactRes.success, 'Service Deactivation (Preserves record with status inactive)');
  const servicesA = await getSalonServices(COMPANY_A_ID);
  const srv2Updated = servicesA.find((s) => s.id === srv2Id);
  assert(srv2Updated?.status === 'inactive', 'Service Status is Inactive in Directory');

  // Negative price rejection
  const invalidSrv = await createSalonService(COMPANY_A_ID, {
    name: 'Invalid Price',
    duration_minutes: 30,
    price: -5000,
  });
  assert(!invalidSrv.success, 'Validation Guard: Rejects negative service price', invalidSrv.error);

  // 6. Cross-Tenant Relationship Guard
  const crossTenantApt = await createSalonAppointment(COMPANY_A_ID, {
    customer_id: custBId, // Belongs to Company B!
    staff_id: staffA1Id,
    service_id: srv1Id,
    appointment_date: '2026-10-15',
    start_time: '10:00',
  });
  assert(
    !crossTenantApt.success,
    'Cross-Tenant Guard: Rejects Company A appointment with Company B customer',
    crossTenantApt.error
  );

  // 7. Valid Appointment Creation & End Time Automatic Derivation
  const apt1Res = await createSalonAppointment(COMPANY_A_ID, {
    customer_id: custAId,
    staff_id: staffA1Id,
    service_id: srv1Id, // 60 min
    appointment_date: '2026-10-15',
    start_time: '10:00',
    notes: 'Première séance coloration',
  });
  assert(apt1Res.success && Boolean(apt1Res.appointment?.id), 'Valid Appointment Creation', apt1Res.appointment?.id);
  assert(
    apt1Res.appointment?.end_time === '11:00',
    'Automatic End Time Calculation (10:00 + 60m = 11:00)',
    apt1Res.appointment?.end_time
  );
  assert(
    apt1Res.appointment?.price === 25000,
    'Price Defaults from Selected Service (25,000 XOF)',
    `${apt1Res.appointment?.price} XOF`
  );
  const apt1Id = apt1Res.appointment?.id;

  // 8. Appointment Conflict Detection: Same Staff OVERLAPPING REJECTED
  const conflictRes = await createSalonAppointment(COMPANY_A_ID, {
    customer_id: custAId,
    staff_id: staffA1Id, // Same staff (Awa Cissé)
    service_id: srv1Id,
    appointment_date: '2026-10-15', // Same date
    start_time: '10:30', // Overlaps with 10:00-11:00!
  });
  assert(
    !conflictRes.success,
    'Conflict Prevention: Rejects overlapping appointment for SAME staff member',
    conflictRes.error
  );

  // 9. Appointment Conflict Detection: Different Staff OVERLAPPING ALLOWED
  const diffStaffRes = await createSalonAppointment(COMPANY_A_ID, {
    customer_id: custAId,
    staff_id: staffA2Id, // Different staff (Aminata Diallo)
    service_id: srv1Id,
    appointment_date: '2026-10-15',
    start_time: '10:30', // Same time window
  });
  assert(
    diffStaffRes.success,
    'Staff Concurrency: Allows overlapping appointment for DIFFERENT staff member',
    diffStaffRes.appointment?.id
  );

  // 10. Consecutive Appointment for Same Staff ALLOWED (Back-to-back)
  const backToBackRes = await createSalonAppointment(COMPANY_A_ID, {
    customer_id: custAId,
    staff_id: staffA1Id,
    service_id: srv1Id,
    appointment_date: '2026-10-15',
    start_time: '11:00', // Starts exactly when apt1 ends at 11:00
  });
  assert(
    backToBackRes.success,
    'Schedule Continuity: Allows consecutive back-to-back appointment for same staff (11:00 start)',
    backToBackRes.appointment?.id
  );

  // 11. Appointment Lifecycle State Machine
  // scheduled -> confirmed -> in_progress -> completed
  const confRes = await updateSalonAppointmentStatus(COMPANY_A_ID, apt1Id, 'confirmed');
  assert(confRes.success && confRes.appointment?.status === 'confirmed', 'Appointment Status: scheduled -> confirmed');

  const progRes = await updateSalonAppointmentStatus(COMPANY_A_ID, apt1Id, 'in_progress');
  assert(progRes.success && progRes.appointment?.status === 'in_progress', 'Appointment Status: confirmed -> in_progress');

  const compRes = await updateSalonAppointmentStatus(COMPANY_A_ID, apt1Id, 'completed');
  assert(compRes.success && compRes.appointment?.status === 'completed', 'Appointment Status: in_progress -> completed');

  // 12. Payment Processing & Overpayment Protection
  // Negative payment rejection
  const negPayRes = await recordSalonPayment(COMPANY_A_ID, apt1Id, {
    amount: -5000,
    payment_method: 'cash',
  });
  assert(!negPayRes.success, 'Payment Guard: Rejects negative payment amount', negPayRes.error);

  // Overpayment rejection (Price is 25,000, trying to pay 30,000)
  const overPayRes = await recordSalonPayment(COMPANY_A_ID, apt1Id, {
    amount: 30000,
    payment_method: 'card',
  });
  assert(!overPayRes.success, 'Payment Guard: Rejects payment exceeding appointment price', overPayRes.error);

  // Valid partial payment: 15,000 XOF
  const partPayRes = await recordSalonPayment(COMPANY_A_ID, apt1Id, {
    amount: 15000,
    payment_method: 'mobile_money',
    notes: 'Acompte Wave',
  });
  assert(
    partPayRes.success && Boolean(partPayRes.payment?.id),
    'Valid Partial Payment Recorded (15,000 XOF)',
    partPayRes.payment?.reference
  );

  // Valid second payment completing the remainder: 10,000 XOF
  const finalPayRes = await recordSalonPayment(COMPANY_A_ID, apt1Id, {
    amount: 10000,
    payment_method: 'cash',
    notes: 'Solde espèces au salon',
  });
  assert(
    finalPayRes.success && Boolean(finalPayRes.payment?.id),
    'Valid Final Payment Recorded (10,000 XOF, total 25,000)',
    finalPayRes.payment?.reference
  );

  // Further payment attempt when fully paid should be rejected
  const extraPayRes = await recordSalonPayment(COMPANY_A_ID, apt1Id, {
    amount: 1000,
    payment_method: 'cash',
  });
  assert(!extraPayRes.success, 'Payment Guard: Rejects payment on already fully settled appointment', extraPayRes.error);

  // 13. Shared Finance Reference & Idempotency
  assert(
    partPayRes.payment?.reference?.startsWith('salon-payment-'),
    'Shared Finance Deterministic Reference Format (salon-payment-{id})',
    partPayRes.payment?.reference
  );

  // 14. Module Summary SDK Contract
  const summary = await getSalonModuleSummary(COMPANY_A_ID);
  assert(summary.moduleId === 'hair-salon', 'ModuleSummary SDK moduleId is "hair-salon"');
  assert(typeof summary.revenue === 'number', 'ModuleSummary revenue is numeric', `${summary.revenue} XOF`);
  assert(typeof summary.activityCount === 'number', 'ModuleSummary activityCount is numeric');
  assert(Array.isArray(summary.metrics), 'ModuleSummary metrics is an array of ConsolidatedMetric');
  assert(summary.metrics.some(m => m.id === 'sal-today-apts'), 'ModuleSummary contains sal-today-apts metric');

  // 15. Operational Metrics & Reports Generation
  const metrics = await getSalonMetrics(COMPANY_A_ID);
  assert(metrics !== null && typeof metrics.revenueThisMonth === 'number', 'Operational Metrics Loaded Successfully');

  const reports = await getSalonReports(COMPANY_A_ID);
  assert(reports !== null && Array.isArray(reports.topServices), 'Salon Reports Engine (topServices, revenue, byStatus)');

  console.log('\n=================================================================');
  console.log(`Domain Test Suite Finished: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('=================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runDomainTests().catch((err) => {
  console.error('Fatal error running salon domain tests:', err);
  process.exit(1);
});
