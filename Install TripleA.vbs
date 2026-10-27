Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
code = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & folder & "\install.ps1""", 0, True)
If code <> 0 Then
  MsgBox "TripleA did not install. Open install.log in this folder.", 16, "TripleA IPTV Player"
End If
