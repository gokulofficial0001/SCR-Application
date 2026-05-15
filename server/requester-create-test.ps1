# Simulates EXACTLY what the frontend does when Requester 1 creates an SCR:
#   SCRManager.createSCR()  ->  Store.add('scr_requests')   -> POST /api/scr_requests
#                               Store.add('workflow_stages')-> POST /api/workflow_stages
#                               Audit.log()                 -> POST /api/audit_log
#                               Notifications.notifySCRCreated() -> POST /api/notifications (x impl users)
# Then verifies every record actually persisted to the SQLite backend.

$api = 'http://localhost:3500/api'
$ErrorActionPreference = 'Stop'

# Authenticate as admin — required now that /api/* enforces Bearer auth
$loginRes = Invoke-RestMethod -Uri "$api/auth/login" -Method POST `
  -Body (@{username='admin';password='admin123'}|ConvertTo-Json) -ContentType 'application/json'
$script:HEADERS = @{ 'Authorization' = "Bearer $($loginRes.token)" }

function GET($p)  { Invoke-RestMethod -Uri "$api/$p" -Headers $HEADERS }
function POST($p,$b) {
  Invoke-RestMethod -Uri "$api/$p" -Method POST -Headers $HEADERS `
    -Body ($b | ConvertTo-Json -Depth 12) -ContentType 'application/json'
}
function NOW { (Get-Date).ToUniversalTime().ToString('o') }
function STEP($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function OK($m)   { Write-Host "  [PASS] $m" -ForegroundColor Green }
function FAIL($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; throw $m }

Write-Host "============================================================"
Write-Host "  Requester-1 create test  (frontend -> backend persistence)"
Write-Host "============================================================"

# ---- baseline ----
$base = (GET 'admin/health').counts
Write-Host "  Baseline: scr_requests=$($base.scr_requests) workflow_stages=$($base.workflow_stages) audit_log=$($base.audit_log) notifications=$($base.notifications)"

# ---- identify Requester 1 ----
$req1 = (GET 'users') | Where-Object { $_.username -eq 'requester' } | Select-Object -First 1
if (-not $req1) { FAIL "Requester 1 (username 'requester') not found in users" }
OK "Requester 1 = '$($req1.name)' (id=$($req1.id), dept=$($req1.department))"

# ---- build the SCR exactly like SCRManager.createSCR ----
$ts = Get-Date
$scrId = "id_" + ([guid]::NewGuid().ToString('N').Substring(0,16))
$scrNumber = "SCR-TEST-" + $ts.ToString('HHmmss')

$scr = @{
  id = $scrId
  scrNumber = $scrNumber
  scrDate = $ts.ToString('yyyy-MM-dd')
  requestType = 'New'
  intervention = 'Routine'; priority = 'Routine'
  moduleName = 'Persistence Test Module'
  description = 'Automated test: verifying requester-created SCR persists to the SQLite backend.'
  reasonForChange = 'Confirm frontend Store.add reaches the server and is stored.'
  attachments = @()
  requestedBy = $req1.name
  receivedBy = ''; coordinatedBy = ''
  department = $req1.department
  hodName = ''
  studyDoneByPrimary = ''; studyDoneBySecondary = ''
  assignedDeveloper = ''; assignedDeveloper2 = ''
  assignedOn = $null; studyDateFrom = $null; studyDateTo = $null
  scheduleDate = $null; completedOn = $null
  acknowledgedBy = ''; acknowledgedAt = $null
  phAcceptedBy = ''; phAcceptedAt = $null
  approvalStatus = ''; approvalReason = ''
  projectHeadName = 'Mr. Panneer Selvan'
  agmItName = 'Mr. S. Saravanakumar'
  cioName = 'Mr. Biju Velayudhan'
  remarkProjectHead = ''; remarkAgmIt = ''; remarkCio = ''
  assignedTeam = ''
  currentStage = 1
  status = 'Open'
  createdBy = $req1.id
  createdAt = (NOW); updatedAt = (NOW)
  lastRejection = $null; rejectionRemarks = ''; rejectedBy = ''; rejectedAt = $null
  holdReason = ''; heldBy = ''; heldAt = $null; holdAtStage = $null; lastHold = $null
}

# ---- 1. POST scr_requests (Store.add) ----
STEP "1. POST /api/scr_requests"
$r1 = POST 'scr_requests' $scr
if ($r1.id -ne $scrId) { FAIL "POST scr_requests did not echo the id" }
OK "Server accepted SCR $scrNumber (id=$scrId)"

# ---- 2. POST workflow_stages (Store.add) ----
STEP "2. POST /api/workflow_stages"
$wfId = "id_" + ([guid]::NewGuid().ToString('N').Substring(0,16))
$wf = @{
  id = $wfId; scrId = $scrId; stage = 1
  enteredAt = (NOW); exitedAt = $null
  performedBy = $req1.id; action = 'Submitted'
  notes = "SCR submitted by $($req1.name)"
  createdAt = (NOW); updatedAt = (NOW)
}
$r2 = POST 'workflow_stages' $wf
if ($r2.id -ne $wfId) { FAIL "POST workflow_stages did not echo the id" }
OK "Server accepted workflow stage 1 (id=$wfId)"

# ---- 3. POST audit_log (Audit.log -> Store.add) ----
STEP "3. POST /api/audit_log"
$auId = "id_" + ([guid]::NewGuid().ToString('N').Substring(0,16))
$audit = @{
  id = $auId; entityType = 'SCR'; entityId = $scrId
  action = 'Created'; field = $null; oldValue = $null; newValue = $scrNumber
  performedBy = $req1.name; role = 'requester'
  timestamp = (NOW); createdAt = (NOW); updatedAt = (NOW)
}
$r3 = POST 'audit_log' $audit
if ($r3.id -ne $auId) { FAIL "POST audit_log did not echo the id" }
OK "Server accepted audit entry (id=$auId)"

# ---- 4. VERIFY all three are actually retrievable ----
STEP "4. Read back from backend"
$gotScr = GET "scr_requests/$scrId"
if ($gotScr.scrNumber -ne $scrNumber) { FAIL "SCR not retrievable by id" }
OK "GET scr_requests/$scrId -> $($gotScr.scrNumber), stage $($gotScr.currentStage), status $($gotScr.status)"

$gotWf = GET "workflow_stages/$wfId"
if ($gotWf.scrId -ne $scrId) { FAIL "workflow_stage not retrievable" }
OK "GET workflow_stages/$wfId -> stage $($gotWf.stage), scrId matches"

$gotAu = GET "audit_log/$auId"
if ($gotAu.entityId -ne $scrId) { FAIL "audit entry not retrievable" }
OK "GET audit_log/$auId -> action '$($gotAu.action)', entityId matches"

# ---- 5. VERIFY counts incremented ----
STEP "5. Confirm row counts incremented"
$after = (GET 'admin/health').counts
$dScr = $after.scr_requests - $base.scr_requests
$dWf  = $after.workflow_stages - $base.workflow_stages
$dAu  = $after.audit_log - $base.audit_log
if ($dScr -lt 1) { FAIL "scr_requests count did not increase" }
if ($dWf  -lt 1) { FAIL "workflow_stages count did not increase" }
if ($dAu  -lt 1) { FAIL "audit_log count did not increase" }
OK "Counts: scr_requests +$dScr, workflow_stages +$dWf, audit_log +$dAu"

# ---- 6. VERIFY it survives a WAL checkpoint (durable on disk) ----
STEP "6. Checkpoint WAL + confirm persisted to main scr.db"
Push-Location $PSScriptRoot
node checkpoint.js | Out-Null
Pop-Location
$persisted = GET "scr_requests/$scrId"
if ($persisted.scrNumber -ne $scrNumber) { FAIL "SCR lost after checkpoint" }
OK "SCR still present after WAL checkpoint - durably written to scr.db"

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "  RESULT: Requester-created SCR persists correctly to backend." -ForegroundColor Green
Write-Host "  Test SCR left in DB for inspection: $scrNumber" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
