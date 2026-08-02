import fs from 'fs';
import path from 'path';

function run() {
  const reportsDir = path.join(process.cwd(), 'backtest', 'reports');
  const m1Csv = path.join(reportsDir, 'mode1_cycles.csv');
  const m2Csv = path.join(reportsDir, 'mode2_cycles.csv');

  let matplotlibAvailable = true;
  try {
    const { execSync } = require('child_process');
    execSync('python3 -c "import matplotlib"', { stdio: 'ignore' });
  } catch {
    matplotlibAvailable = false;
  }

  if (!matplotlibAvailable) {
    console.log('[PLOT] matplotlib not available or python3 missing. Skipping image rendering.');
    return;
  }

  // Python script using matplotlib
  const code = `
import os
import pandas as pd
import matplotlib.pyplot as plt

reports_dir = r"${reportsDir.replace(/\\/g, '/')}"
m1_path = os.path.join(reports_dir, "mode1_cycles.csv")
m2_path = os.path.join(reports_dir, "mode2_cycles.csv")

if os.path.exists(m1_path) and os.path.exists(m2_path):
    df1 = pd.read_csv(m1_path)
    df2 = pd.read_csv(m2_path)
    
    df1_comp = df1[df1['status'] == 'COMPLETED']
    df2_comp = df2[df2['status'] == 'COMPLETED']
    
    # 1. Equity Curves
    plt.figure(figsize=(10, 5))
    if not df1_comp.empty:
        plt.plot(df1_comp['cycleId'], df1_comp['netPnl'].cumsum(), label="Mode 1 (½-Premium Ratio)", marker='o')
    if not df2_comp.empty:
        plt.plot(df2_comp['cycleId'], df2_comp['netPnl'].cumsum(), label="Mode 2 (Same-Strike Calendar)", marker='s')
    plt.title("Cumulative Equity Curve Comparison (Net P&L)")
    plt.xlabel("Cycle ID")
    plt.ylabel("Cumulative Net P&L (₹)")
    plt.xticks(rotation=45)
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(reports_dir, "equity_curves.png"))
    plt.close()
    
    # 2. P&L Distribution
    plt.figure(figsize=(10, 5))
    if not df1_comp.empty:
        plt.hist(df1_comp['netPnl'], alpha=0.5, label="Mode 1", bins=10)
    if not df2_comp.empty:
        plt.hist(df2_comp['netPnl'], alpha=0.5, label="Mode 2", bins=10)
    plt.title("Per-Cycle Net P&L Distribution")
    plt.xlabel("Net P&L (₹)")
    plt.ylabel("Frequency")
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(reports_dir, "pnl_distribution.png"))
    plt.close()
    print("Charts generated successfully.")
`;

  const scriptPath = path.join(process.cwd(), 'backtest', 'scripts', '_tmp_plot.py');
  const scriptsDir = path.dirname(scriptPath);
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }
  fs.writeFileSync(scriptPath, code, 'utf8');

  try {
    const { execSync } = require('child_process');
    execSync(`python3 "${scriptPath}"`, { stdio: 'inherit' });
  } catch (err: any) {
    console.warn('[PLOT] matplotlib rendering failed:', err.message);
  } finally {
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
    }
  }
}

run();
