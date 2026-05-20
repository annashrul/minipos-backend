#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const prisma = new PrismaClient();
  
  try {
    const sqlPath = path.join(__dirname, './prisma/migrations/manual/phase52_stock_movement_unit.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running migration: phase52_stock_movement_unit.sql');
    await prisma.$executeRawUnsafe(sql);
    console.log('✓ Migration applied successfully');
    
    // Verify columns were created
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'stock_movements' 
      AND column_name IN ('unitId', 'unitQuantity')
      ORDER BY column_name
    `);
    
    console.log('✓ Columns verified:');
    result.forEach(row => console.log(`  - ${row.column_name}`));
    
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
