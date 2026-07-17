import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { StudentFee, Payment } from '../models/index.js';

const isExecute = process.argv.includes('--execute');
const modeText = isExecute ? 'EXECUTE MODE (Applying Changes)' : 'DRY RUN MODE (No Database Modifications)';

async function repairDuplicates() {
  const logLines = [];
  const log = (msg) => {
    console.log(msg);
    logLines.push(msg);
  };

  log('==========================================================');
  log(`STUDENT FEE DUPLICATE REPAIR MIGRATION`);
  log(`Mode: ${modeText}`);
  log(`Time: ${new Date().toISOString()}`);
  log('==========================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/school_project';
    log(`Connecting to MongoDB...`);
    await mongoose.connect(mongoUri);
    log(`Successfully connected to MongoDB.\n`);

    const allFees = await StudentFee.find().lean();
    const totalScanned = allFees.length;
    log(`Total StudentFee records scanned: ${totalScanned}`);

    // Group by studentId + feeCategoryId
    const groupMap = new Map();
    for (const fee of allFees) {
      const sid = fee.studentId ? fee.studentId.toString() : 'null';
      const cid = fee.feeCategoryId ? fee.feeCategoryId.toString() : 'null';
      const key = `${sid}_${cid}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key).push(fee);
    }

    const duplicateGroups = [];
    for (const [key, docs] of groupMap.entries()) {
      if (docs.length > 1) {
        duplicateGroups.push({ key, docs });
      }
    }

    const totalDuplicateGroups = duplicateGroups.length;
    log(`Total duplicate groups found: ${totalDuplicateGroups}\n`);

    let totalDuplicateRecords = 0;
    let totalRepaired = 0;
    let totalSkipped = 0;
    let totalManualReview = 0;

    const repairedIds = [];
    const skippedIds = [];
    const manualReviewIds = [];

    // Get all Payments to check references
    const allPayments = await Payment.find().lean();
    const referencedFeeIds = new Set();

    for (const p of allPayments) {
      if (p.studentFeeId) {
        referencedFeeIds.add(p.studentFeeId.toString());
      }
      if (p.feeAllocations && Array.isArray(p.feeAllocations)) {
        for (const alloc of p.feeAllocations) {
          if (alloc.studentFeeId) {
            referencedFeeIds.add(alloc.studentFeeId.toString());
          }
        }
      }
    }

    log(`Payment reference check complete. Total distinct StudentFee IDs referenced in payments: ${referencedFeeIds.size}\n`);

    for (let i = 0; i < duplicateGroups.length; i++) {
      const { key, docs } = duplicateGroups[i];
      totalDuplicateRecords += (docs.length - 1);
      log(`--- Group ${i + 1}/${duplicateGroups.length} [Key: ${key}] (${docs.length} docs) ---`);

      // Analyze payment history in this group
      const paidDocs = docs.filter(d => (d.paidAmount || 0) > 0 || referencedFeeIds.has(d._id.toString()));
      const unpaidDocs = docs.filter(d => (d.paidAmount || 0) === 0 && !referencedFeeIds.has(d._id.toString()));

      log(`  Paid/Referenced docs count: ${paidDocs.length}`);
      log(`  Unpaid/Unreferenced docs count: ${unpaidDocs.length}`);

      if (paidDocs.length > 1) {
        // Case 1B: Multiple paid records exist - DO NOT MERGE AUTOMATICALLY
        log(`  [MANUAL REVIEW REQUIRED] Multiple paid/referenced records exist in duplicate group.`);
        totalManualReview += docs.length;
        manualReviewIds.push(...docs.map(d => d._id.toString()));
      } else if (paidDocs.length === 1) {
        // Case 1A: Exactly 1 paid record. Keep paid record, delete genuine unpaid duplicates.
        const keeper = paidDocs[0];
        log(`  Keeper (Paid/Referenced): ${keeper._id} (Total: ${keeper.totalAmount}, Paid: ${keeper.paidAmount}, Remaining: ${keeper.remainingAmount})`);

        for (const d of unpaidDocs) {
          log(`  Marked for deletion (Unpaid duplicate): ${d._id} (Total: ${d.totalAmount}, Remaining: ${d.remainingAmount})`);
          if (isExecute) {
            await StudentFee.findByIdAndDelete(d._id);
          }
          repairedIds.push(d._id.toString());
          totalRepaired++;
        }
      } else {
        // Case 2: All docs are unpaid. Pick the best doc to keep (prefer non-zero totalAmount, newest createdAt)
        // Sort: preferred first (non-zero totalAmount, newest createdAt)
        docs.sort((a, b) => {
          if ((b.totalAmount || 0) !== (a.totalAmount || 0)) {
            return (b.totalAmount || 0) - (a.totalAmount || 0);
          }
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });

        const keeper = docs[0];
        const toDelete = docs.slice(1);

        log(`  Keeper (Unpaid Best): ${keeper._id} (Total: ${keeper.totalAmount}, Remaining: ${keeper.remainingAmount}, Created: ${keeper.createdAt})`);

        for (const d of toDelete) {
          log(`  Marked for deletion (Unpaid duplicate): ${d._id} (Total: ${d.totalAmount}, Remaining: ${d.remainingAmount})`);
          if (isExecute) {
            await StudentFee.findByIdAndDelete(d._id);
          }
          repairedIds.push(d._id.toString());
          totalRepaired++;
        }
      }
    }

    log('\n==========================================================');
    log('MIGRATION SUMMARY');
    log('==========================================================');
    log(`Mode:                         ${modeText}`);
    log(`Total StudentFee Scanned:     ${totalScanned}`);
    log(`Total Duplicate Groups:       ${totalDuplicateGroups}`);
    log(`Total Duplicate Extra Docs:   ${totalDuplicateRecords}`);
    log(`Total Records Repaired/Deleted: ${totalRepaired}`);
    log(`Total Records Skipped:        ${totalSkipped}`);
    log(`Total Records Manual Review:  ${totalManualReview}`);
    log(`Repaired Record IDs:          ${JSON.stringify(repairedIds)}`);
    log(`Manual Review Record IDs:     ${JSON.stringify(manualReviewIds)}`);
    log('==========================================================\n');

    // Write log report to file
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFileName = `duplicate_repair_${isExecute ? 'execute' : 'dryrun'}_${Date.now()}.log`;
    const logFilePath = path.join(logDir, logFileName);
    fs.writeFileSync(logFilePath, logLines.join('\n'), 'utf8');
    log(`Report log saved to: ${logFilePath}`);

    await mongoose.disconnect();
    log(`MongoDB disconnected cleanly.`);
  } catch (err) {
    console.error('Fatal Migration Error:', err);
    process.exit(1);
  }
}

repairDuplicates();
