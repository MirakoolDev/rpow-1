use sha2::{Sha256, Digest};
use std::time::{Instant, Duration};
use std::sync::mpsc;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use chrono::Local;

const API_BASE: &str = "https://api.rpow2.com";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Challenge {
    challenge_id: String,
    nonce_prefix: String,
    difficulty_bits: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct MintResponse {
    token: Token,
}

#[derive(Debug, Serialize, Deserialize)]
struct Token {
    id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Wallet {
    email: String,
    balance: u64,
    minted: u64,
    sent: u64,
    received: u64,
}

#[derive(Debug, Clone)]
enum WorkerMsg {
    Progress(u64),
    Found(String),
}

fn format_number(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result.chars().rev().collect()
}

fn trailing_zero_bits(buf: &[u8]) -> u32 {
    let mut count = 0;
    for &b in buf.iter().rev() {
        if b == 0 {
            count += 8;
            continue;
        }
        count += b.trailing_zeros();
        break;
    }
    count
}

fn api_fetch<T: for<'de> Deserialize<'de>>(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    cookie: &Option<String>,
) -> Result<T, Box<dyn std::error::Error>> {
    let url = format!("{}{}", API_BASE, path);
    let mut req = match method {
        "POST" => minreq::post(&url),
        "GET" => minreq::get(&url),
        _ => return Err("Unsupported method".into()),
    };

    req = req.with_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
             .with_header("Origin", "https://rpow2.com")
             .with_header("Referer", "https://rpow2.com/")
             .with_header("Accept", "application/json, text/plain, */*")
             .with_header("Accept-Language", "en-US,en;q=0.9");

    if let Some(c) = cookie {
        req = req.with_header("Cookie", c);
    }

    let res = if let Some(b) = body {
        req.with_body(serde_json::to_string(&b)?).with_header("Content-Type", "application/json").send()?
    } else {
        req.send()?
    };

    if res.status_code >= 400 {
        let body_text = res.as_str().unwrap_or("No body");
        return Err(format!("API Error {}: {}", res.status_code, body_text).into());
    }

    let data = serde_json::from_str::<T>(res.as_str()?)?;
    Ok(data)
}

fn mine_worker(
    prefix_hex: String,
    target: u32,
    worker_id: u64,
    num_workers: u64,
    tx: mpsc::Sender<WorkerMsg>,
) {
    let prefix = hex::decode(prefix_hex).expect("Invalid prefix hex");
    let mut buf = vec![0u8; prefix.len() + 8];
    buf[..prefix.len()].copy_from_slice(&prefix);

    let mut nonce = worker_id;
    let step = num_workers;
    let mut count = 0;
    let mut last_report = Instant::now();

    loop {
        let mut x = nonce;
        for i in 0..8 {
            buf[prefix.len() + i] = (x & 0xff) as u8;
            x >>= 8;
        }

        let mut hasher = Sha256::new();
        hasher.update(&buf);
        let digest = hasher.finalize();

        if trailing_zero_bits(&digest) >= target {
            let _ = tx.send(WorkerMsg::Found(nonce.to_string()));
            return;
        }

        nonce += step;
        count += 1;

        if count % 500_000 == 0 {
            if last_report.elapsed() >= Duration::from_secs(1) {
                if tx.send(WorkerMsg::Progress(count)).is_err() {
                    return;
                }
                count = 0;
                last_report = Instant::now();
            }
        }
    }
}

fn update_wallet(cookie: &Option<String>) -> Option<Wallet> {
    api_fetch::<Wallet>("GET", "/me", None, cookie).ok()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== rpow2 Rust Miner ===");

    let max_cores = num_cpus::get();
    print!("How many CPU cores to use? (1-{}, default: {}): ", max_cores, max_cores);
    io::stdout().flush()?;
    let mut core_input = String::new();
    io::stdin().read_line(&mut core_input)?;
    let num_workers = core_input.trim().parse::<u64>().unwrap_or(max_cores as u64);

    println!("\n1) Login via Email (Magic Link)");
    println!("2) Bypass Captcha (Paste Session Cookie)");
    print!("\nSelect option (1 or 2): ");
    io::stdout().flush()?;
    let mut choice = String::new();
    io::stdin().read_line(&mut choice)?;

    let mut session_cookie: Option<String> = None;

    if choice.trim() == "2" {
        println!("\nTo get your cookie:");
        println!("1. Login to the website in your browser");
        println!("2. Open Developer Tools (F12) -> Application -> Cookies");
        println!("3. Copy the value of the 'rpow_session' cookie");
        print!("\nPaste rpow_session value: ");
        io::stdout().flush()?;
        let mut cookie_value = String::new();
        io::stdin().read_line(&mut cookie_value)?;
        session_cookie = Some(format!("rpow_session={}", cookie_value.trim()));
    } else {
        print!("\nEnter your email to login: ");
        io::stdout().flush()?;
        let mut email = String::new();
        io::stdin().read_line(&mut email)?;
        let email = email.trim();

        println!("Requesting magic link...");
        let _: serde_json::Value = api_fetch("POST", "/auth/request", Some(serde_json::json!({ "email": email })), &None)?;

        println!("\nMagic link sent! Please check your email.");
        print!("Paste the magic link here: ");
        io::stdout().flush()?;
        let mut link = String::new();
        io::stdin().read_line(&mut link)?;
        
        let token = link.split("token=").nth(1).and_then(|s| s.split('&').next()).ok_or("Could not find token in link")?;

        println!("Verifying token...");
        let verify_url = format!("{}/auth/verify?token={}", API_BASE, token);
        let res = minreq::get(&verify_url).send()?;
        
        let mut session_cookie_str = String::new();
        for (name, val) in res.headers {
            if name.to_lowercase() == "set-cookie" {
                if val.contains("rpow_session") {
                    session_cookie_str = val.split(';').next().unwrap_or("").to_string();
                    break;
                }
            }
        }
        
        if session_cookie_str.is_empty() {
             return Err("Failed to find rpow_session cookie.".into());
        }
        session_cookie = Some(session_cookie_str);
    }

    let mut wallet = update_wallet(&session_cookie);
    let mut session_minted = 0;
    let mut last_token_id = String::new();

    println!("\x1B[2J\x1B[H"); // Clear screen

    loop {
        let status = "FETCHING CHALLENGE...";
        render_dashboard(wallet.as_ref(), num_workers, 0, "0.00", 0, status, session_minted, &last_token_id);

        let ch: Challenge = match api_fetch("POST", "/challenge", None, &session_cookie) {
            Ok(c) => c,
            Err(e) => {
                let status = format!("ERROR: {}", e);
                render_dashboard(wallet.as_ref(), num_workers, 0, "0.00", 0, &status, session_minted, &last_token_id);
                std::thread::sleep(Duration::from_secs(5));
                continue;
            }
        };

        let (tx, rx) = mpsc::channel();
        let prefix_hex = ch.nonce_prefix.clone();
        let target = ch.difficulty_bits;

        for i in 0..num_workers {
            let tx_clone = tx.clone();
            let prefix_clone = prefix_hex.clone();
            std::thread::spawn(move || {
                mine_worker(prefix_clone, target, i, num_workers, tx_clone);
            });
        }

        let start_time = Instant::now();
        let mut total_hashes = 0;
        let solution_nonce: String;

        loop {
            if let Ok(msg) = rx.recv_timeout(Duration::from_millis(250)) {
                match msg {
                    WorkerMsg::Progress(h) => {
                        total_hashes += h;
                        let elapsed = start_time.elapsed().as_secs_f64();
                        let rate = if elapsed > 0.0 { (total_hashes as f64 / 1_000_000.0) / elapsed } else { 0.0 };
                        render_dashboard(wallet.as_ref(), num_workers, target, &format!("{:.2}", rate), total_hashes, "MINING", session_minted, &last_token_id);
                    }
                    WorkerMsg::Found(nonce) => {
                        solution_nonce = nonce;
                        break;
                    }
                }
            } else {
                let elapsed = start_time.elapsed().as_secs_f64();
                let rate = if elapsed > 0.0 { (total_hashes as f64 / 1_000_000.0) / elapsed } else { 0.0 };
                render_dashboard(wallet.as_ref(), num_workers, target, &format!("{:.2}", rate), total_hashes, "MINING", session_minted, &last_token_id);
            }
        }

        drop(tx); 

        render_dashboard(wallet.as_ref(), num_workers, target, "0.00", total_hashes, "SUBMITTING...", session_minted, &last_token_id);

        let mint_res: Result<MintResponse, _> = api_fetch("POST", "/mint", Some(serde_json::json!({
            "challenge_id": ch.challenge_id,
            "solution_nonce": solution_nonce
        })), &session_cookie);

        match mint_res {
            Ok(data) => {
                session_minted += 1;
                last_token_id = data.token.id;
                wallet = update_wallet(&session_cookie);
            }
            Err(e) => {
                let status = format!("MINT FAILED: {}", e);
                render_dashboard(wallet.as_ref(), num_workers, target, "0.00", total_hashes, &status, session_minted, &last_token_id);
                std::thread::sleep(Duration::from_secs(3));
            }
        }
    }
}

fn render_dashboard(
    wallet: Option<&Wallet>,
    num_workers: u64,
    target: u32,
    rate: &str,
    hashes: u64,
    status: &str,
    session_minted: u64,
    last_token_id: &str,
) {
    print!("\x1B[H"); 
    let now = Local::now().format("%H:%M:%S");

    if let Some(w) = wallet {
        println!("+-- WALLET ---------------------------------------");
        println!("  LOGGED IN AS : {}", w.email);
        println!("  BALANCE      : {:04} RPOW", w.balance);
        println!("  MINTED       : {:04}", w.minted);
        println!("  SENT         : {:04}", w.sent);
        println!("  RECEIVED     : {:04}", w.received);
    }

    println!("+-- MINE (Rust x{} Threads) ------------------------", num_workers);
    println!();
    println!("  TARGET           : {} trailing zero bits", if target == 0 { "--".to_string() } else { target.to_string() });
    println!("  HASHES (current) : {}", format_number(hashes));
    println!("  RATE             : {} MH/s", rate);
    println!("  TIME             : {}", now);
    println!("  STATUS           : {}", status);
    println!("  MINED THIS RUN   : {}", session_minted);
    println!("  LAST TOKEN       : {}", if last_token_id.is_empty() { "--" } else { last_token_id });
    println!();
    println!("---------------------------------------------------");
    println!("Press Ctrl+C to stop");
    let _ = io::stdout().flush();
}
