param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Source))
$ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
function Read-Part([string]$Name) {
    $reader = [IO.StreamReader]::new($archive.GetEntry($Name).Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Set-Text($Cell, [string]$Text) {
    while ($Cell.HasChildNodes) { [void]$Cell.RemoveChild($Cell.FirstChild) }
    $Cell.SetAttribute('t', 'inlineStr')
    $inline = $Cell.OwnerDocument.CreateElement('is', $ns)
    $textNode = $Cell.OwnerDocument.CreateElement('t', $ns)
    $textNode.InnerText = $Text
    [void]$inline.AppendChild($textNode)
    [void]$Cell.AppendChild($inline)
}
try {
    [xml]$stringsDoc = Read-Part 'xl/sharedStrings.xml'
    $strings = @($stringsDoc.sst.si | ForEach-Object { $_.InnerText })
    $parts = [ordered]@{}
    foreach ($name in @('xl/styles.xml','xl/theme/theme1.xml')) { $parts[$name] = Read-Part $name }
    $sheets = @()
    foreach ($index in 1,2,3) {
        $name = "xl/worksheets/sheet$index.xml"
        [xml]$doc = Read-Part $name
        $manager = [Xml.XmlNamespaceManager]::new($doc.NameTable)
        $manager.AddNamespace('s', $ns)
        foreach ($cell in @($doc.SelectNodes('//s:c', $manager))) {
            $row = [int]($cell.r -replace '[A-Z]', '')
            $col = $cell.r -replace '[0-9]', ''
            $text = if ($cell.t -eq 's') { $strings[[int]$cell.v] } else { '' }
            if ($index -eq 3) {
                if ($cell.r -eq 'A3') {
                    Set-Text $cell "Formulas:`nCost of Quality = Prevention + Appraisal + Internal Failure + External Failure Costs`nTest Coverage (%) = Test Cases Passed / Test Cases Executed * 100`nDefect Density = Defects Found / KLOC`nDefect Leakage (%) = Production Defects / Total Defects * 100`nMTTR (hrs) = Total Resolution Time / Total Incidents`nMTTD (hrs) = Total Detection Time / Total Incidents"
                } else {
                    while ($cell.HasChildNodes) { [void]$cell.RemoveChild($cell.FirstChild) }
                    $cell.RemoveAttribute('t')
                }
            } elseif ($row -le 2 -or ($col -eq 'C' -and $text -match '^Week [1-4]$')) {
                if ($cell.t -eq 's') { Set-Text $cell $text }
            } else {
                while ($cell.HasChildNodes) { [void]$cell.RemoveChild($cell.FirstChild) }
                $cell.RemoveAttribute('t')
                if ($row -ge 3 -and $row -le 76) {
                    $formula = ''
                    if ($index -eq 1 -and $col -eq 'N') { $formula = "IFERROR(IF(F$row=`"`",`"`",G$row/F$row),`"`")" }
                    if ($index -eq 1 -and $col -eq 'O') { $formula = "IFERROR(IF(H$row=`"`",`"`",I$row/H$row*100),`"`")" }
                    if ($index -eq 2 -and $col -eq 'O') { $formula = "IF(COUNT(F${row}:I$row)=0,`"`",SUM(F${row}:I$row))" }
                    if ($index -eq 2 -and $col -eq 'P') { $formula = "IFERROR(IF(J$row=`"`",`"`",K$row/J$row*100),`"`")" }
                    if ($index -eq 2 -and $col -eq 'Q') { $formula = "IFERROR(IF(L$row=`"`",`"`",M$row/L$row),`"`")" }
                    if ($formula) {
                        $f = $doc.CreateElement('f', $ns)
                        $f.InnerText = $formula
                        [void]$cell.AppendChild($f)
                    }
                }
            }
        }
        # Remove authoring identifiers, selections and external document metadata.
        foreach ($node in @($doc.SelectNodes('//*[local-name()="extLst"]'))) { [void]$node.ParentNode.RemoveChild($node) }
        $parts[$name] = $doc.OuterXml
        $sheets += [ordered]@{
            name = @('Engineering Metrics','Operations Metrics','Formulas')[$index - 1]
            path = $name
            merges = @($doc.worksheet.mergeCells.mergeCell | ForEach-Object { $_.ref })
            columns = @($doc.worksheet.cols.col | ForEach-Object { [ordered]@{ min=[int]$_.min; max=[int]$_.max; width=[double]$_.width } })
        }
    }
    $parts['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    $parts['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    $parts['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Engineering Metrics" sheetId="1" r:id="rId1"/><sheet name="Operations Metrics" sheetId="2" r:id="rId2"/><sheet name="Formulas" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191028" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'
    $parts['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>'
    $json = [ordered]@{ sheets=$sheets; parts=$parts } | ConvertTo-Json -Depth 12 -Compress
    $output = Join-Path $PSScriptRoot '..\quality-metrics-template.js'
    [IO.File]::WriteAllText($output, "// Generated by tools/build-quality-template.ps1; sanitized layout only.`n(function(root){ const template=$json; if(typeof module==='object'&&module.exports)module.exports=template;else root.QualityMetricsTemplate=template; })(globalThis);`n", [Text.UTF8Encoding]::new($false))
} finally { $archive.Dispose() }
