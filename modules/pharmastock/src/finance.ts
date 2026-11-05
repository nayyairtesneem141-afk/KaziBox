import { getPharmaStockClient } from './client.js';
import { PharmaInventoryService, PrescriptionSale, RestockBatchParams, withTenantTransaction } from './inventory.js';

export class PharmaFinanceSync {
  /**
   * Executes a sale in PharmaStock and immediately transmits operational revenue
   * to KaziBox shared finance ledger with an idempotent reference.
   * Serialized within the tenant transaction queue to prevent lost updates.
   */
  static async executeSaleAndSync(
    companyId: string,
    params: {
      reference: string;
      items: Array<{ medicationId: string; quantity: number }>;
      patientName?: string;
      prescriberDoctor?: string;
      currency?: string;
    }
  ): Promise<{ sale: PrescriptionSale; syncResult: any }> {
    return withTenantTransaction(companyId, async () => {
      // 1. Record in local tenant inventory (under transaction lock)
      const sale = PharmaInventoryService.recordSale(companyId, params);

      // 2. Transmit to KaziBox finance ledger
      const client = getPharmaStockClient(companyId);
      const syncResult = await client.recordRevenue({
        amount: sale.totalAmount,
        currency: sale.currency,
        source: `PharmaStock — Prescription & Vente Comptoir (${params.reference})`,
        reference: `PHARMA-REV-${sale.reference}`,
        occurredAt: sale.createdAt,
        metadata: {
          itemCount: sale.items.length,
          patient: sale.patientName,
          doctor: sale.prescriberDoctor,
        },
      });

      // 3. Emit business event
      await client.emitEvent({
        action: 'prescription.fulfilled',
        entity: 'prescription_sale',
        entityId: sale.id,
        details: {
          reference: sale.reference,
          amount: sale.totalAmount,
          currency: sale.currency,
        },
      });

      return { sale, syncResult };
    });
  }

  /**
   * Executes a batch restock and immediately transmits operational expense
   * to KaziBox shared finance ledger with an idempotent reference.
   * Serialized within the tenant transaction queue to prevent lost updates.
   */
  static async executeRestockAndSync(
    companyId: string,
    params: RestockBatchParams
  ): Promise<{ restock: any; syncResult: any }> {
    return withTenantTransaction(companyId, async () => {
      // 1. Record restock in local tenant inventory (under transaction lock)
      const restock = PharmaInventoryService.recordRestock(companyId, params);

      // 2. Transmit expense to KaziBox ledger
      const client = getPharmaStockClient(companyId);
      const syncResult = await client.recordExpense({
        amount: restock.totalExpense,
        category: 'Approvisionnement Médicaments / Lots Grossiste',
        reference: `PHARMA-EXP-${params.reference}`,
        metadata: {
          medication: restock.medication.name,
          batchNumber: params.batchNumber,
          quantity: params.quantity,
        },
      });

      return { restock, syncResult };
    });
  }
}
