#This is a fork of RPOW2

It contains a PC miner of RPOW; A faithful modern recreation of Hal Finney's [Reusable Proofs of Work](https://nakamotoinstitute.org/finney/rpow/) (2004). Magic-link auth, hashcash mining (~30s on a modern MacBook), Ed25519-signed tokens, email-keyed transfers, public ledger.

Here is a complete README draft for your new GitHub repository. You can copy and paste this directly into your `README.md` file!

***



A multi-threaded PC miner for the **RPOW2 (Reusable Proofs of Work)** project. 

While the official RPOW2 web client relies on a single-threaded WebAssembly worker in your browser, this standalone Node.js script automatically detects your CPU cores and spawns dedicated worker threads to utilize **100% of your CPU**. This allows you to mine tokens significantly faster than the browser.

## Features
- **🚀 Max Performance:** Uses Node.js `worker_threads` to max out your CPU.
- **🪶 Zero Dependencies:** Built entirely using native Node.js libraries (`crypto`, `os`, `worker_threads`). No `node_modules` required!
- **🔐 Secure Login:** Authenticates securely by requesting and verifying a magic link straight to your email.
- **🔄 Auto-Fetch:** Automatically fetches your wallet balance in the background after every successful mint.

## Prerequisites
All you need is **Node.js v18.0.0 or higher** installed on your system.

## How to Run

1. Clone this repository or download the `pc_miner.js` file.
2. Open your terminal in the folder containing the script.
3. Run the following command:
   ```bash
   node pc_miner.js
   ```
4. Enter your email when prompted.
5. Check your email for the magic link, paste the URL into the terminal, and watch it mine!

## Creating a Standalone Executable (Optional)

If you want to run this on machines without installing Node.js, you can compile it into a standalone executable (`.exe` for Windows, or binaries for Linux/macOS) using `pkg`.

1. Install `pkg` globally:
   ```bash
   npm install -g pkg
   ```
2. Compile the script:
   **For Windows:**
   ```bash
   pkg pc_miner.js --targets node18-win-x64 --output rpow-miner.exe
   ```
   **For Linux:**
   ```bash
   pkg pc_miner.js --targets node18-linux-x64 --output rpow-miner-linux
   ```

## License
[MIT License](LICENSE) - Feel free to use, modify, and distribute this code!
