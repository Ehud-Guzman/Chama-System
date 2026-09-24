# Turns USER_INTERACTION_GUIDE.docx into a PDF, using Word.
#
#   powershell -NoProfile -File make_user_interaction_guide_pdf.ps1
#
# Word is used rather than a converter because the document carries a real table
# of contents and page-number fields: something has to compute them. This script
# runs each stage on its own and reports it, because Word can sit on one of these
# calls without saying anything, and a script that hangs in silence is worse than
# one that fails. The .docx is saved back after the update, so the Word file also
# opens with a built contents page rather than a prompt to build one, and the PDF
# is exported from that very same file - so the two can never be out of step.

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$docx      = Join-Path $root 'USER_INTERACTION_GUIDE.docx'
$pdf       = Join-Path $root 'USER_INTERACTION_GUIDE.pdf'
# Word's PDF publish hangs on this folder - a path with spaces under Desktop,
# watched by whatever the machine has running on it. It writes the same file to
# the temp folder in seconds, so that is where the PDF is made and it is copied
# over afterwards. The .docx is written in place and has never been a problem.
$pdfTemp   = Join-Path $env:TEMP 'chama-user-interaction-guide.pdf'
$log       = Join-Path $env:TEMP 'chama-user-guide-pdf.log'
$timeout   = 240

function Step($message) {
    "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $message | Tee-Object -FilePath $log -Append
}

if (-not (Test-Path $docx)) {
    throw "Not found: $docx. Run 'python build_user_interaction_guide.py' first."
}
foreach ($stale in @($pdf, $pdfTemp)) {
    if (Test-Path $stale) { Remove-Item $stale -Force }
}
"---- $(Get-Date) ----" | Out-File $log

$work = {
    param($source, $target)

    $word = $null
    $document = $null
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = 0
        $word.Options.UpdateFieldsAtPrint = $false

        $document = $word.Documents.Open($source, $false, $false)

        # The contents page and the page numbers are fields: they only exist once
        # a word processor has walked the document and written them in.
        try { $document.TablesOfContents.Item(1).Update() } catch { }

        # Saved back, so the Word file opens with a built contents page rather
        # than a prompt to build one.
        $document.Save()

        # 17 = wdFormatPDF. SaveAs rather than ExportAsFixedFormat: the export
        # call has a long argument list, and one default in the wrong place is a
        # long wait with nothing on screen to show for it.
        $document.SaveAs2($target, 17)
        $pages = $document.ComputeStatistics(2)
    }
    finally {
        if ($document) { $document.Close(0) }
        if ($word) { $word.Quit() }
    }
    return $pages
}

$job = Start-Job -ScriptBlock $work -ArgumentList $docx, $pdfTemp
$finished = Wait-Job $job -Timeout $timeout

if (-not $finished) {
    Stop-Job $job -ErrorAction SilentlyContinue
    Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force
    Remove-Job $job -Force
    Step "FAILED: Word did not finish in $timeout seconds"
    throw "Word did not finish writing the PDF in $timeout seconds. See $log."
}

$pages = Receive-Job $job
Remove-Job $job -Force

if (-not (Test-Path $pdfTemp)) {
    Step 'FAILED: Word finished but wrote no PDF'
    throw "Word finished without writing $pdfTemp. See $log."
}

Copy-Item $pdfTemp $pdf -Force
Step ("PDF copied into the repository ({0:N0} bytes, {1} pages)" -f (Get-Item $pdf).Length, $pages)
Write-Host ("wrote {0} ({1:N0} bytes, {2} pages)" -f $pdf, (Get-Item $pdf).Length, $pages)
