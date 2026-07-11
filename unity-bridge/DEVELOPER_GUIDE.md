# ArcadeX Unity Developer Guide

Integrate Unity WebGL games with the ArcadeX shell: personal best saves, paid leaderboard submits, and contest support.

## Files to copy into your Unity project

| File | Unity location |
|------|----------------|
| `unity-bridge/ArcadeXBridge.cs` | `Assets/Scripts/ArcadeXBridge.cs` (any folder) |
| `unity-bridge/ArcadeXBridge.jslib` | `Assets/Plugins/WebGL/ArcadeXBridge.jslib` |

The bridge auto-creates an `ArcadeXBridge` GameObject at startup. No scene setup required.

---

## Architecture

```
Unity (iframe)                    ArcadeX shell (parent)
─────────────                     ──────────────────────
SaveProgress(score)    ───────►   GAME_PROGRESS_SAVE → RTDB personal best
SubmitToLeaderboard()  ───────►   GAME_LEADERBOARD_SUBMIT → MiniPay tx → leaderboard
                                  (personal best is NOT changed)
```

- **Personal best** lives at `users/{wallet}/games/{gameId}.s` — updated only by `GAME_PROGRESS_SAVE`.
- **Public leaderboard** lives at `leaderboards/{gameId}` — updated only by paid `GAME_LEADERBOARD_SUBMIT`.
- During a contest, users may submit multiple times (one payment each). The leaderboard keeps their **highest** score.
- When a new contest starts, admins reset the leaderboard; personal bests stay unchanged.

---

## Message reference (Unity → shell)

| Message | Purpose |
|---------|---------|
| `GAME_BOOTSTRAP` | Request wallet, player name, high score, contest flag |
| `GAME_PROGRESS_SAVE` | Save personal best (free) |
| `GAME_PROGRESS_GET` | Refresh personal best / level |
| `GAME_LEADERBOARD_GET` | Fetch public leaderboard rows |
| `GAME_LEADERBOARD_SUBMIT` | Paid submit — posts score to leaderboard |

### Legacy aliases (still accepted)

| Legacy | Maps to |
|--------|---------|
| `MINIPAY_BOOTSTRAP` | `GAME_BOOTSTRAP` |
| `MINIPAY_SAVE_PROGRESS` | `GAME_PROGRESS_SAVE` |
| `MINIPAY_SUBMIT_SCORE` | `GAME_PROGRESS_SAVE` |
| `MINIPAY_GET_PROGRESS` | `GAME_PROGRESS_GET` |
| `MINIPAY_GET_LEADERBOARD` | `GAME_LEADERBOARD_GET` |

---

## Shell → Unity callbacks

| Callback | When |
|----------|------|
| `OnBootstrapDataReceived` | After `GAME_BOOTSTRAP` |
| `OnProgressSaved` | After `GAME_PROGRESS_SAVE` |
| `OnScoreSubmitted` | Legacy alias for `OnProgressSaved` |
| `OnProgressReceived` | After `GAME_PROGRESS_GET` |
| `OnLeaderboardReceived` | After `GAME_LEADERBOARD_GET` |
| `OnLeaderboardSubmitComplete` | After paid submit (success or failure) |
| `OnWalletAddressResolved` | Wallet connected |

---

## Recommended game-over flow

```csharp
// 1. Game ends — save personal best (always)
ArcadeXBridge.Instance.SaveProgress(finalScore);

// 2. Show Submit Score button (always visible on game over)
// User taps Submit Score:
ArcadeXBridge.Instance.SubmitToLeaderboard(finalScore);
```

Subscribe to results:

```csharp
void OnEnable()
{
    ArcadeXBridge.Instance.ProgressSaved += HandleProgressSaved;
    ArcadeXBridge.Instance.LeaderboardSubmitCompleted += HandleLeaderboardSubmit;
}

void HandleProgressSaved(ArcadeXProgressSaveResult result)
{
    if (result.success)
    {
        // result.highScore = updated personal best
    }
}

void HandleLeaderboardSubmit(ArcadeXLeaderboardSubmitResult result)
{
    if (result.success)
    {
        // Payment succeeded
        // result.highScore = personal best (unchanged by submit)
        // result.leaderboardScore = user's score on public leaderboard
        ShowMessage("Score submitted!");
    }
    else
    {
        // Payment failed or user rejected tx
        ShowMessage(result.error);
    }
}
```

While waiting for payment, disable the button and show **"Submitting…"**. The MiniPay wallet opens in the **parent** window, not inside Unity.

---

## Payload shapes

### Send: `GAME_PROGRESS_SAVE`

```json
{
  "type": "GAME_PROGRESS_SAVE",
  "payload": {
    "score": 550,
    "walletAddress": "0x..."
  }
}
```

### Receive: `OnProgressSaved`

```json
{
  "success": true,
  "highScore": 550
}
```

### Send: `GAME_LEADERBOARD_SUBMIT`

```json
{
  "type": "GAME_LEADERBOARD_SUBMIT",
  "payload": {
    "score": 550
  }
}
```

Use the **session score** (this run's score), not necessarily the all-time personal best.

### Receive: `OnLeaderboardSubmitComplete`

The shell may retry delivery for a few seconds after the wallet closes (MiniPay).

Success:

```json
{
  "success": true,
  "highScore": 600,
  "leaderboardScore": 550,
  "error": ""
}
```

Failure:

```json
{
  "success": false,
  "highScore": 600,
  "leaderboardScore": 0,
  "error": "Insufficient balance. You need $0.05 in USDT or USDC."
}
```

A legacy **`OnScoreSubmitted`** callback is also fired with `{ success, highScore, error }` for older game code.

### Receive: `OnBootstrapDataReceived`

```json
{
  "gameId": "dot-connect",
  "shellOrigin": "https://arcadex.example.com",
  "walletAddress": "0x...",
  "playerName": "Kushal",
  "highScore": 600,
  "level": 0,
  "hasLeaderboard": true,
  "contestLive": true
}
```

---

## C# API summary

```csharp
ArcadeXBridge.Instance.SaveProgress(int score);
ArcadeXBridge.Instance.SubmitToLeaderboard(int score);
ArcadeXBridge.Instance.RequestLeaderboard();
ArcadeXBridge.Instance.RequestProgress();
ArcadeXBridge.Instance.SendBootstrap();
```

Properties after bootstrap:

```csharp
ArcadeXBridge.Instance.HighScore      // personal best
ArcadeXBridge.Instance.ContestLive    // contest badge active
ArcadeXBridge.Instance.PlayerName
ArcadeXBridge.Instance.WalletAddress
```

---

## UI guidelines

1. **Submit Score button** — show on game over at all times (no gating on personal best vs leaderboard score).
2. **Personal best display** — optional; read from `HighScore` after bootstrap or `OnProgressSaved`.
3. **Contest** — if `ContestLive` is true, you may show a "CONTEST LIVE" label in your game-over UI (shell also shows badges).
4. **Re-submit** — allowed any time; each tap runs a new payment. Leaderboard keeps the highest score.
5. **Player name** — required for paid submit. If missing, shell prompts the name modal; Unity should handle `success: false` gracefully.

---

## Shell UI

Score submission happens **inside Unity only** via `SubmitToLeaderboard(score)`.

The pre-game menu still has a **Leaderboard** button (view-only rankings). There is no shell submit panel or high-score banner.

---

## Testing outside MiniPay

In the Unity Editor, bridge calls log to the console instead of sending messages. Test WebGL builds inside the ArcadeX Mini App / MiniPay environment for payment flows.

---

## Contest reset (admin)

Starting a new contest clears `leaderboards/{gameId}` in Firebase RTDB. Personal bests in `users/{wallet}/games/{gameId}.s` are **not** cleared. Players submit fresh scores for each contest period.

---

## Questions?

Contact the ArcadeX team or open an issue in the repo.
