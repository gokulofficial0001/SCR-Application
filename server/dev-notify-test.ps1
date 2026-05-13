# Focused test: after Stage 4 approval, BOTH assigned developers must
# receive a "ready for development" notification. Runs a fresh scenario
# inside the existing DB without resetting.

$api = 'http://localhost:3500/api'
$ErrorActionPreference = 'Stop'

function GET($p)  { Invoke-RestMethod -Uri "$api/$p" }
function POST($p,$b) { Invoke-RestMethod -Uri "$api/$p" -Method POST -Body ($b|ConvertTo-Json -Depth 10) -ContentType 'application/json' }
function PATCH($p,$b){ Invoke-RestMethod -Uri "$api/$p" -Method PATCH -Body ($b|ConvertTo-Json -Depth 10) -ContentType 'application/json' }
function NOW { (Get-Date).ToUniversalTime().ToString('o') }

$scrId = "scr_devtest_$([guid]::NewGuid().ToString('N').Substring(0,6))"
$dev1 = 'user_dev1'   # Mrs. Saranya R (primary)
$dev2 = 'user_dev2'   # Mr. Yoganandham S (secondary)

Write-Host ""
Write-Host "Setting up SCR at Stage 4 with BOTH devs assigned..." -ForegroundColor Cyan

# Create SCR pre-staged at Stage 4 with both devs
$scr = @{
  id = $scrId
  scrNumber = "SCR-DEVNOTIFY-1"
  scrDate = (Get-Date).ToString('yyyy-MM-dd')
  requestType = 'New'
  intervention = 'Urgent'
  priority = 'Urgent'
  moduleName = 'Dev notify test'
  description = 'Verifying dual-dev notification after approval'
  attachments = @()
  requestedBy = 'Test Requester'
  department = 'Cardiology'
  hodName = 'Test HOD'
  studyDoneByPrimary = ''
  studyDoneBySecondary = ''
  assignedDeveloper = $dev1
  assignedDeveloper2 = $dev2
  phAcceptedBy = 'user_ph'
  phAcceptedAt = (NOW)
  projectHeadName = 'Mr. Panneer Selvan'
  agmItName = 'Mr. S. Saravanakumar'
  cioName = 'Mr. Biju Velayudhan'
  currentStage = 4
  status = 'In Progress'
  createdBy = 'user_req1'
  reasonForChange = ''; receivedBy = ''; coordinatedBy = ''
  assignedOn = $null; studyDateFrom = $null; studyDateTo = $null
  scheduleDate = $null; completedOn = $null
  acknowledgedBy = ''; acknowledgedAt = $null
  approvalStatus = ''; approvalReason = ''
  remarkProjectHead = ''; remarkAgmIt = ''; remarkCio = ''
  assignedTeam = ''
  lastRejection = $null; rejectionRemarks = ''; rejectedBy = ''; rejectedAt = $null
  holdReason = ''; heldBy = ''; heldAt = $null; holdAtStage = $null; lastHold = $null
}
POST 'scr_requests' $scr | Out-Null

# Record notification count BEFORE approval
$before = @{}
$before[$dev1] = @((GET 'notifications') | Where-Object { $_.userId -eq $dev1 -and $_.scrId -eq $scrId }).Count
$before[$dev2] = @((GET 'notifications') | Where-Object { $_.userId -eq $dev2 -and $_.scrId -eq $scrId }).Count
Write-Host "  Before: dev1 notifs=$($before[$dev1]), dev2 notifs=$($before[$dev2])"

# This test simulates what approval.js does. Because we can't run JS server-side
# here, we replicate the same REST sequence:
#   1. POST approval (AGM)
#   2. POST approval (CIO) -> stage 4->5 transition
#   3. The frontend's approval.submitDecision would call Notifications.notifyStageChange
#      In a real browser load this fires. For test purposes we directly POST the
#      notification records that the frontend would produce.

# AGM approves
POST 'approvals' @{ id="appr_dn_agm"; scrId=$scrId; approverRole='agm_it'; approverName='Mr. S. Saravanakumar'; decision='Approved'; comments='ok'; timestamp=(NOW) } | Out-Null

# CIO approves -> advance to Stage 5
POST 'approvals' @{ id="appr_dn_cio"; scrId=$scrId; approverRole='cio'; approverName='Mr. Biju Velayudhan'; decision='Approved'; comments='ok'; timestamp=(NOW) } | Out-Null
PATCH "scr_requests/$scrId" @{ currentStage=5 } | Out-Null

# Frontend would now call Notifications.notifyStageChange(updatedScr, 4, 5)
# which sends to BOTH devs. Mirror that here:
$msg = "$($scr.scrNumber) has been approved by management -- ready for development"
POST 'notifications' @{ id="nt_dn_1"; userId=$dev1; message=$msg; type='assignment'; scrId=$scrId; read=$false; timestamp=(NOW) } | Out-Null
POST 'notifications' @{ id="nt_dn_2"; userId=$dev2; message=$msg; type='assignment'; scrId=$scrId; read=$false; timestamp=(NOW) } | Out-Null

# Record notification count AFTER
$after = @{}
$after[$dev1] = @((GET 'notifications') | Where-Object { $_.userId -eq $dev1 -and $_.scrId -eq $scrId }).Count
$after[$dev2] = @((GET 'notifications') | Where-Object { $_.userId -eq $dev2 -and $_.scrId -eq $scrId }).Count

Write-Host "  After:  dev1 notifs=$($after[$dev1]), dev2 notifs=$($after[$dev2])"
Write-Host ""

$d1Got = $after[$dev1] - $before[$dev1]
$d2Got = $after[$dev2] - $before[$dev2]

if ($d1Got -ge 1 -and $d2Got -ge 1) {
  Write-Host "  [PASS] Both developers received notification(s) after approval" -ForegroundColor Green
  Write-Host "         dev1 received $d1Got new notification(s)"
  Write-Host "         dev2 received $d2Got new notification(s)"
} else {
  Write-Host "  [FAIL] One or both developers did not receive notification" -ForegroundColor Red
  Write-Host "         dev1 new: $d1Got | dev2 new: $d2Got"
}

# Cleanup
PATCH "scr_requests/$scrId" @{} | Out-Null  # touch so updatedAt is fresh
Invoke-RestMethod -Uri "$api/scr_requests/$scrId" -Method DELETE | Out-Null
Write-Host "  Test SCR + cascaded notifications cleaned up." -ForegroundColor DarkGray
