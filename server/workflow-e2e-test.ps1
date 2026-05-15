# End-to-end workflow test against the SQLite backend.
# Drives the same REST calls the frontend would, all 6 stages.

$api = 'http://localhost:3500/api'
$ErrorActionPreference = 'Stop'

# === Authenticate as admin - required now that /api/* enforces Bearer auth ===
try {
  $loginRes = Invoke-RestMethod -Uri "$api/auth/login" -Method POST `
    -Body (@{username='admin';password='admin123'}|ConvertTo-Json) -ContentType 'application/json'
  $script:HEADERS = @{ 'Authorization' = "Bearer $($loginRes.token)" }
} catch {
  Write-Host "  [FATAL] Could not log in as admin/admin123 - cannot run test." -ForegroundColor Red
  Write-Host "          Make sure the server is up and the admin password is correct."
  throw
}

function POST($path, $body) {
  Invoke-RestMethod -Uri "$api/$path" -Method POST -Headers $HEADERS `
    -Body ($body | ConvertTo-Json -Depth 10) -ContentType 'application/json'
}
function PATCH($path, $body) {
  Invoke-RestMethod -Uri "$api/$path" -Method PATCH -Headers $HEADERS `
    -Body ($body | ConvertTo-Json -Depth 10) -ContentType 'application/json'
}
function PUT($path, $body) {
  Invoke-RestMethod -Uri "$api/$path" -Method PUT -Headers $HEADERS `
    -Body ($body | ConvertTo-Json -Depth 10) -ContentType 'application/json'
}
function GET($path) {
  Invoke-RestMethod -Uri "$api/$path" -Headers $HEADERS
}
function NOW { (Get-Date).ToUniversalTime().ToString('o') }
function TODAY { (Get-Date).ToString('yyyy-MM-dd') }

function STEP($n, $title) {
  Write-Host ""
  Write-Host ("-" * 70) -ForegroundColor DarkGray
  Write-Host ("  STEP $n  -  $title") -ForegroundColor Cyan
  Write-Host ("-" * 70) -ForegroundColor DarkGray
}
function OK($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green }
function FAIL($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; throw $msg }

# =====================================================================
STEP 0 "Reset DB + seed users/departments/SLA"
# =====================================================================

Invoke-RestMethod -Uri "$api/admin/reset" -Method POST -Headers $HEADERS | Out-Null

# IMPORTANT: use the SAME canonical user IDs as Store.ensureDefaultUsers()
# (user_dev1 / user_req1, not user_dev / user_req) so that a browser load
# after this test does not create duplicate user records.
$users = @(
  @{ id='user_admin'; name='System Admin';         username='admin';       password='admin123'; role='admin';          email='admin@h.in';     department='Information Technology' },
  @{ id='user_impl';  name='Mrs. Saranya P';       username='impl';        password='impl123';  role='implementation'; email='saranya.p@h.in'; department='Information Technology' },
  @{ id='user_ph';    name='Mr. Panneer Selvan';   username='projecthead'; password='ph123';    role='project_head';   email='panneer@h.in';   department='Information Technology' },
  @{ id='user_agm';   name='Mr. S. Saravanakumar'; username='agm';         password='agm123';   role='agm_it';         email='agm@h.in';       department='Information Technology' },
  @{ id='user_cio';   name='Mr. Biju Velayudhan';  username='cio';         password='cio123';   role='cio';            email='cio@h.in';       department='Information Technology' },
  @{ id='user_dev1';  name='Mrs. Saranya R';       username='developer';   password='dev123';   role='developer';      email='saranya.r@h.in'; department='Information Technology' },
  @{ id='user_req1';  name='Dr. Ramesh Kumar';     username='requester';   password='req123';   role='requester';      email='ramesh@h.in';    department='Cardiology' }
)
PUT 'users' $users | Out-Null
OK ("Seeded {0} users" -f $users.Count)

$depts = @(
  @{ id='dept_1'; name='Cardiology';             hodName='Dr. Ramesh Kumar';  hodEmail='ramesh@h.in';  coordinatorName=''; coordinatorEmail='' },
  @{ id='dept_2'; name='Information Technology'; hodName='Mr. Panneer Selvan'; hodEmail='panneer@h.in'; coordinatorName='Mr. Gokulraj S'; coordinatorEmail='gokulraj@h.in' }
)
PUT 'departments' $depts | Out-Null
OK ("Seeded {0} departments" -f $depts.Count)

$sla = @(
  @{ id='sla_emergency'; priority='Emergency'; maxHours=24 },
  @{ id='sla_urgent';    priority='Urgent';    maxHours=72 },
  @{ id='sla_routine';   priority='Routine';   maxHours=168 }
)
PUT 'sla_config' $sla | Out-Null
OK ("Seeded {0} SLA rows" -f $sla.Count)

PUT 'meta/seeded' $true | Out-Null
PUT 'meta/migration_version' 11 | Out-Null
OK "Meta flags set"

# =====================================================================
STEP 1 "Requester creates SCR (Stage 1)"
# =====================================================================

$scrId = "scr_e2e_$([guid]::NewGuid().ToString('N').Substring(0,8))"
$scrNumber = "SCR-2026-E2E1"

$scr = @{
  id = $scrId
  scrNumber = $scrNumber
  scrDate = TODAY
  requestType = 'New'
  intervention = 'Urgent'
  priority = 'Urgent'
  moduleName = 'OPD Token Display'
  description = 'E2E test: install OPD token display on screen 2'
  reasonForChange = 'Reduce queue confusion at OPD reception'
  attachments = @()
  requestedBy = 'Dr. Ramesh Kumar'
  receivedBy = ''
  coordinatedBy = ''
  department = 'Cardiology'
  hodName = 'Dr. Ramesh Kumar'
  studyDoneByPrimary = ''
  studyDoneBySecondary = ''
  assignedDeveloper = ''
  assignedDeveloper2 = ''
  assignedOn = $null
  studyDateFrom = $null
  studyDateTo = $null
  scheduleDate = $null
  completedOn = $null
  acknowledgedBy = ''
  acknowledgedAt = $null
  phAcceptedBy = ''
  phAcceptedAt = $null
  approvalStatus = ''
  approvalReason = ''
  projectHeadName = 'Mr. Panneer Selvan'
  agmItName = 'Mr. S. Saravanakumar'
  cioName = 'Mr. Biju Velayudhan'
  remarkProjectHead = ''
  remarkAgmIt = ''
  remarkCio = ''
  assignedTeam = ''
  currentStage = 1
  status = 'Open'
  createdBy = 'user_req1'
  lastRejection = $null
  rejectionRemarks = ''
  rejectedBy = ''
  rejectedAt = $null
  holdReason = ''
  heldBy = ''
  heldAt = $null
  holdAtStage = $null
  lastHold = $null
}
POST 'scr_requests' $scr | Out-Null
OK "Created $scrNumber at Stage 1, status=Open"

$wf1 = @{ id="wf_e2e_1"; scrId=$scrId; stage=1; enteredAt=(NOW); exitedAt=$null; performedBy='user_req1'; action='Submitted'; notes='SCR submitted by Dr. Ramesh Kumar' }
POST 'workflow_stages' $wf1 | Out-Null
POST 'audit_log' @{ id="aud_e2e_1"; entityType='SCR'; entityId=$scrId; action='Created'; field=$null; oldValue=$null; newValue=$scrNumber; performedBy='Dr. Ramesh Kumar'; role='requester'; timestamp=(NOW) } | Out-Null

# =====================================================================
STEP 2 "Implementation accepts (Stage 1 to 2, auto-stamps receivedBy)"
# =====================================================================

PATCH "workflow_stages/wf_e2e_1" @{ exitedAt=(NOW); exitedBy='user_impl'; action='Completed' } | Out-Null
$wf2 = @{ id="wf_e2e_2"; scrId=$scrId; stage=2; enteredAt=(NOW); exitedAt=$null; performedBy='user_impl'; action='In Progress'; notes='Advanced by Mrs. Saranya P' }
POST 'workflow_stages' $wf2 | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=2; status='In Progress'; receivedBy='Mrs. Saranya P' } | Out-Null
POST 'audit_log' @{ id="aud_e2e_2"; entityType='SCR'; entityId=$scrId; action='Auto-filled'; field='receivedBy'; oldValue=$null; newValue='Mrs. Saranya P'; performedBy='Mrs. Saranya P'; role='implementation'; timestamp=(NOW) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_3"; entityType='SCR'; entityId=$scrId; action='Stage Advanced'; field='currentStage'; oldValue='Requirement Submission'; newValue='Implementation Review'; performedBy='Mrs. Saranya P'; role='implementation'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.currentStage -ne 2) { FAIL "Expected stage 2, got $($scr.currentStage)" }
if ($scr.receivedBy -ne 'Mrs. Saranya P') { FAIL "receivedBy not auto-stamped" }
OK "Stage advanced to 2, receivedBy = '$($scr.receivedBy)'"

# =====================================================================
STEP 3 "Implementation forwards to Project Head (Stage 2 to 3)"
# =====================================================================

PATCH "workflow_stages/wf_e2e_2" @{ exitedAt=(NOW); exitedBy='user_impl'; action='Completed' } | Out-Null
$wf3 = @{ id="wf_e2e_3"; scrId=$scrId; stage=3; enteredAt=(NOW); exitedAt=$null; performedBy='user_impl'; action='In Progress'; notes='Forwarded to PH by Mrs. Saranya P' }
POST 'workflow_stages' $wf3 | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=3 } | Out-Null
POST 'audit_log' @{ id="aud_e2e_4"; entityType='SCR'; entityId=$scrId; action='Stage Advanced'; field='currentStage'; oldValue='Implementation Review'; newValue='Project Head Review'; performedBy='Mrs. Saranya P'; role='implementation'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.currentStage -ne 3) { FAIL "Expected stage 3, got $($scr.currentStage)" }
OK "Stage advanced to 3 (PH Review pending)"

# =====================================================================
STEP 4 "Project Head Accept for Review (Stage 3 gate)"
# =====================================================================

PATCH "scr_requests/$scrId" @{ phAcceptedBy='user_ph'; phAcceptedAt=(NOW); projectHeadName='Mr. Panneer Selvan' } | Out-Null
POST 'audit_log' @{ id="aud_e2e_5"; entityType='SCR'; entityId=$scrId; action='PH Accepted for Review'; field='phAcceptedBy'; oldValue=$null; newValue='Mr. Panneer Selvan'; performedBy='Mr. Panneer Selvan'; role='project_head'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.phAcceptedBy -ne 'user_ph') { FAIL "phAcceptedBy not set" }
OK "PH accepted (phAcceptedBy=$($scr.phAcceptedBy))"

# =====================================================================
STEP 5 "PH assigns developer + advances to Mgmt Approval (3 to 4)"
# =====================================================================

PATCH "workflow_stages/wf_e2e_3" @{ exitedAt=(NOW); exitedBy='user_ph'; action='Completed' } | Out-Null
$wf4 = @{ id="wf_e2e_4"; scrId=$scrId; stage=4; enteredAt=(NOW); exitedAt=$null; performedBy='user_ph'; action='In Progress'; notes='Advanced by Mr. Panneer Selvan' }
POST 'workflow_stages' $wf4 | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=4; assignedDeveloper='user_dev1'; assignedOn=(TODAY); projectHeadName='Mr. Panneer Selvan' } | Out-Null
POST 'audit_log' @{ id="aud_e2e_6"; entityType='SCR'; entityId=$scrId; action='Stage Advanced'; field='currentStage'; oldValue='Project Head Review'; newValue='Management Approval'; performedBy='Mr. Panneer Selvan'; role='project_head'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.currentStage -ne 4) { FAIL "Expected stage 4, got $($scr.currentStage)" }
if ($scr.assignedDeveloper -ne 'user_dev1') { FAIL "Developer not assigned" }
OK "Stage 4 (assignedDeveloper=$($scr.assignedDeveloper))"

# =====================================================================
STEP 6 "AGM + CIO dual approval (Stage 4 to 5)"
# =====================================================================

POST 'approvals' @{ id="appr_e2e_agm"; scrId=$scrId; approverRole='agm_it'; approverName='Mr. S. Saravanakumar'; decision='Approved'; comments='AGM approved'; timestamp=(NOW) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_7"; entityType='SCR'; entityId=$scrId; action='Approved'; field='decision'; oldValue=$null; newValue='Approved'; performedBy='Mr. S. Saravanakumar'; role='agm_it'; timestamp=(NOW) } | Out-Null

$apprs = GET "approvals"
$agmCount = @($apprs | Where-Object { $_.scrId -eq $scrId -and $_.approverRole -eq 'agm_it' }).Count
if ($agmCount -ne 1) { FAIL "AGM approval not recorded (count=$agmCount)" }
OK "AGM approved (still at Stage 4, awaiting CIO)"

POST 'approvals' @{ id="appr_e2e_cio"; scrId=$scrId; approverRole='cio'; approverName='Mr. Biju Velayudhan'; decision='Approved'; comments='CIO approved'; timestamp=(NOW) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_8"; entityType='SCR'; entityId=$scrId; action='Approved'; field='decision'; oldValue=$null; newValue='Approved'; performedBy='Mr. Biju Velayudhan'; role='cio'; timestamp=(NOW) } | Out-Null

PATCH "workflow_stages/wf_e2e_4" @{ exitedAt=(NOW); exitedBy='user_cio'; action='Approved' } | Out-Null
$wf5 = @{ id="wf_e2e_5"; scrId=$scrId; stage=5; enteredAt=(NOW); exitedAt=$null; performedBy='user_cio'; action='In Progress'; notes='Management approval complete - assigned to Development' }
POST 'workflow_stages' $wf5 | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=5; agmItName='Mr. S. Saravanakumar'; cioName='Mr. Biju Velayudhan' } | Out-Null
POST 'audit_log' @{ id="aud_e2e_9"; entityType='SCR'; entityId=$scrId; action='Stage Advanced'; field='currentStage'; oldValue='Management Approval'; newValue='Development'; performedBy='Mr. Biju Velayudhan'; role='cio'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.currentStage -ne 5) { FAIL "Expected stage 5, got $($scr.currentStage)" }
OK "Both approved -- advanced to Stage 5 (Development)"

# =====================================================================
STEP 7 "Developer acknowledges + posts dev updates"
# =====================================================================

PATCH "scr_requests/$scrId" @{ acknowledgedBy='user_dev1'; acknowledgedAt=(NOW) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_10"; entityType='SCR'; entityId=$scrId; action='Acknowledged'; field='acknowledgedBy'; oldValue=$null; newValue='Mrs. Saranya R'; performedBy='Mrs. Saranya R'; role='developer'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.acknowledgedBy -ne 'user_dev1') { FAIL "acknowledgedBy not set" }
OK "Developer acknowledged"

POST 'development_updates' @{ id="du_e2e_1"; scrId=$scrId; authorId='user_dev1'; authorName='Mrs. Saranya R'; title='Frontend UI complete'; description='Token display rendered with CSS animations'; status='In Progress'; percentComplete=50; timestamp=(NOW) } | Out-Null
POST 'development_updates' @{ id="du_e2e_2"; scrId=$scrId; authorId='user_dev1'; authorName='Mrs. Saranya R'; title='Backend API'; description='Token API integrated with HIS'; status='Completed'; percentComplete=100; timestamp=(NOW) } | Out-Null

$ups = @((GET 'development_updates') | Where-Object { $_.scrId -eq $scrId })
if ($ups.Count -ne 2) { FAIL "Expected 2 dev updates, got $($ups.Count)" }
OK "Posted $($ups.Count) dev updates (avg progress 75%)"

# =====================================================================
STEP 8 "Developer submits to QA (Stage 5 to 6)"
# =====================================================================

PATCH "workflow_stages/wf_e2e_5" @{ exitedAt=(NOW); exitedBy='user_dev1'; action='Completed' } | Out-Null
$wf6 = @{ id="wf_e2e_6"; scrId=$scrId; stage=6; enteredAt=(NOW); exitedAt=$null; performedBy='user_dev1'; action='In Progress'; notes='Submitted to QA by Mrs. Saranya R' }
POST 'workflow_stages' $wf6 | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=6 } | Out-Null
POST 'audit_log' @{ id="aud_e2e_11"; entityType='SCR'; entityId=$scrId; action='Stage Advanced'; field='currentStage'; oldValue='Development'; newValue='QA & Closure'; performedBy='Mrs. Saranya R'; role='developer'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.currentStage -ne 6) { FAIL "Expected stage 6, got $($scr.currentStage)" }
OK "Submitted to QA (Stage 6)"

# =====================================================================
STEP 9 "Implementation closes ticket (Stage 6 QA sign-off)"
# =====================================================================

PATCH "workflow_stages/wf_e2e_6" @{ exitedAt=(NOW); exitedBy='user_impl'; action='Closed' } | Out-Null
PATCH "scr_requests/$scrId" @{ status='Closed'; completedOn=(TODAY) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_12"; entityType='SCR'; entityId=$scrId; action='Ticket Closed'; field='status'; oldValue='In Progress'; newValue='Closed'; performedBy='Mrs. Saranya P'; role='implementation'; timestamp=(NOW) } | Out-Null

$scr = GET "scr_requests/$scrId"
if ($scr.status -ne 'Closed') { FAIL "Expected status=Closed, got $($scr.status)" }
if (-not $scr.completedOn) { FAIL "completedOn not set" }
OK "SCR Closed (completedOn=$($scr.completedOn))"

# =====================================================================
STEP 10 "Requester submits feedback on closed SCR"
# =====================================================================

POST 'feedback' @{ id="fb_e2e_1"; scrId=$scrId; q1=5; q2=4; q3=5; q4=4; q5=5; avgScore=4.6; comments='Quick and clean delivery!'; submittedBy='user_req1'; timestamp=(NOW) } | Out-Null
POST 'audit_log' @{ id="aud_e2e_13"; entityType='SCR'; entityId=$scrId; action='Feedback Submitted'; field='avgScore'; oldValue=$null; newValue='4.6'; performedBy='Dr. Ramesh Kumar'; role='requester'; timestamp=(NOW) } | Out-Null

$fbs = @((GET 'feedback') | Where-Object { $_.scrId -eq $scrId })
if ($fbs.Count -ne 1) { FAIL "Feedback not recorded" }
OK "Feedback submitted (avg=$($fbs[0].avgScore) / 5)"

# =====================================================================
STEP 11 "Final verification"
# =====================================================================

$scr = GET "scr_requests/$scrId"
$workflows = @((GET 'workflow_stages') | Where-Object { $_.scrId -eq $scrId })
$approvals = @((GET 'approvals') | Where-Object { $_.scrId -eq $scrId })
$updates = @((GET 'development_updates') | Where-Object { $_.scrId -eq $scrId })
$audits = @((GET 'audit_log') | Where-Object { $_.entityId -eq $scrId })
$feedbacks = @((GET 'feedback') | Where-Object { $_.scrId -eq $scrId })

Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Green
Write-Host "  SCR $($scr.scrNumber) -- Final State" -ForegroundColor Green
Write-Host "  ======================================================" -ForegroundColor Green
Write-Host ("    Stage          : QA and Closure (currentStage={0})" -f $scr.currentStage)
Write-Host ("    Status         : {0}" -f $scr.status)
Write-Host ("    Received By    : {0}" -f $scr.receivedBy)
Write-Host ("    PH Accepted    : {0} at {1}" -f $scr.phAcceptedBy, $scr.phAcceptedAt)
Write-Host ("    Developer      : {0} (acknowledged at {1})" -f $scr.assignedDeveloper, $scr.acknowledgedAt)
Write-Host ("    Completed On   : {0}" -f $scr.completedOn)
Write-Host ""
Write-Host "  Workflow stages   : $($workflows.Count)   (expected 6)"
Write-Host "  Approvals         : $($approvals.Count)   (expected 2)"
Write-Host "  Dev updates       : $($updates.Count)   (expected 2)"
Write-Host "  Audit log entries : $($audits.Count)   (expected 13)"
Write-Host "  Feedback entries  : $($feedbacks.Count)   (expected 1)"
Write-Host ""

$pass = $true
if ($workflows.Count -ne 6) { Write-Host "  [FAIL] workflow_stages count mismatch" -ForegroundColor Red; $pass = $false }
if ($approvals.Count -ne 2) { Write-Host "  [FAIL] approvals count mismatch" -ForegroundColor Red; $pass = $false }
if ($updates.Count -ne 2) { Write-Host "  [FAIL] development_updates count mismatch" -ForegroundColor Red; $pass = $false }
if ($feedbacks.Count -ne 1) { Write-Host "  [FAIL] feedback count mismatch" -ForegroundColor Red; $pass = $false }
if ($scr.status -ne 'Closed') { Write-Host "  [FAIL] status is not Closed" -ForegroundColor Red; $pass = $false }

if ($pass) {
  Write-Host "  [PASS] All assertions passed -- workflow end-to-end verified" -ForegroundColor Green
} else {
  Write-Host "  [FAIL] Some assertions failed" -ForegroundColor Red
  exit 1
}
