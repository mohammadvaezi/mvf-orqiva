; [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
; ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
; ── [PCODE-76 | S08 | v0.1.0] Turn the setup into a Windows wizard that installs VS Code, Claude Code and all prerequisites ──
;    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/c938fb29-5154-46b5-b079-cd9dae242e6a/
;    Why:  Orqiva-Setup.exe is the one file a fresh Windows machine needs. It is a real wizard: it
;          shows what is missing (Node.js, Git, Python, VS Code, Claude Code), installs what is ticked,
;          asks for the Plane key on a page of its own, and runs the same PowerShell installer the ZIP
;          uses - hidden, logged, with its progress shown here - so there is still one installer to
;          maintain, not two. The key reaches the child process through an inherited environment
;          variable, never a command line or a file, and is cleared as soon as that process ends.
;
;    Build:  powershell -File tools\build-installer.ps1   (stages the bundle, zips it, compiles this)
;    By hand: ISCC.exe /DBundleDir=<staged bundle> /DAppVersion=<version> installer\Orqiva.iss

#define AppName "Orqiva"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
; [PCODE-76 | S08 | v0.1.0] a compile-time folder: {tmp} only exists on the target machine
#ifndef BundleDir
  #define BundleDir "..\dist-installer\bundle"
#endif
#define AppPublisher "Farivarz"
#define AppURL "https://github.com/Farivarz/Orqiva"

[Setup]
AppId={{8E6F2C91-44B7-4E2A-9E0D-7B1F3A5C6D20}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
DefaultDirName={localappdata}\Orqiva
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
; user-scope: no administrator rights, nothing outside this user's profile
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 1809: the oldest that has winget
MinVersion=10.0.17763
OutputDir=..\dist-installer
OutputBaseFilename=Orqiva-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
LicenseFile=..\LICENSE
UninstallDisplayName={#AppName} {#AppVersion}
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This will set up Orqiva on your computer: Plane + Claude Code, with the Orqiva extension for Visual Studio Code.%n%nWhatever is missing - Node.js, Git, Python, Visual Studio Code and Claude Code - is downloaded and installed for you. An internet connection is needed.%n%nEverything is installed for this Windows user only.

; ── [PCODE-76 | S08 | v0.1.0] one checkbox per missing tool; tools already here are not offered ──
[Tasks]
Name: "node"; Description: "Node.js LTS - runs the Plane MCP server"; GroupDescription: "Install what is missing on this computer:"; Check: IsMissing('node')
Name: "git"; Description: "Git for Windows - needed by Claude Code"; GroupDescription: "Install what is missing on this computer:"; Check: IsMissing('git')
Name: "python"; Description: "Python 3.12 - runs the Orqiva engine"; GroupDescription: "Install what is missing on this computer:"; Check: IsMissing('python')
Name: "vscode"; Description: "Visual Studio Code"; GroupDescription: "Install what is missing on this computer:"; Check: IsMissing('vscode')
Name: "claude"; Description: "Claude Code (command line)"; GroupDescription: "Install what is missing on this computer:"; Check: IsMissing('claude')
Name: "extension"; Description: "Install the Orqiva extension into Visual Studio Code"; GroupDescription: "Orqiva:"

[Files]
; [PCODE-76 | S08 | v0.1.0] no skipifsourcedoesntexist: an empty bundle must fail the build, not ship
Source: "{#BundleDir}\*"; DestDir: "{app}\bundle"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Orqiva"; Filename: "{app}\engine\PlaneClaude.bat"; WorkingDir: "{app}\engine"
Name: "{group}\Orqiva guide"; Filename: "{app}\bundle\docs\guide.md"
Name: "{group}\Uninstall Orqiva"; Filename: "{uninstallexe}"

; ── [PCODE-76 | S08 | v0.1.0] the finish page: sign in to Claude Code, open the editor, read the log ──
[Run]
Filename: "{cmd}"; Parameters: "/k ""{code:ClaudePath}"""; Description: "Sign in to Claude Code now (opens a terminal)"; Flags: postinstall nowait skipifsilent; Check: HasClaude
Filename: "{code:CodePath}"; Description: "Open Visual Studio Code"; Flags: postinstall nowait skipifsilent; Check: HasCode
Filename: "{app}\install.log"; Description: "Show the installation log"; Flags: postinstall shellexec skipifsilent unchecked; Check: HasLog

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bundle\install\Uninstall-Orqiva.ps1"" -InstallRoot ""{app}"" -NonInteractive -KeepCredentials"; \
  Flags: waituntilterminated runhidden; RunOnceId: "RemoveOrqiva"

[UninstallDelete]
Type: files; Name: "{app}\install.log"

[Code]
// ── [PCODE-76 | S08 | v0.1.0] Windows calls: the key travels as an inherited environment variable ──
function SetEnvironmentVariable(lpName: String; lpValue: String): BOOL;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';
function DeleteEnvironmentVariable(lpName: String; lpValue: Cardinal): BOOL;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';
function ExpandEnvironmentStrings(lpSrc: String; lpDst: String; nSize: DWORD): DWORD;
  external 'ExpandEnvironmentStringsW@kernel32.dll stdcall';

var
  PlanePage: TInputQueryWizardPage;
  LaterBox: TNewCheckBox;
  Failures: String;

// ── [PCODE-76 | S08 | v0.1.0] detection: PATH first, then where a per-user install lands ──
function OnPath(const Name: String): Boolean;
begin
  Result := FileSearch(Name, GetEnv('PATH')) <> '';
end;

function FirstExisting(const A, B, C: String): String;
begin
  Result := '';
  if (A <> '') and FileExists(A) then Result := A
  else if (B <> '') and FileExists(B) then Result := B
  else if (C <> '') and FileExists(C) then Result := C;
end;

function ClaudePath(Param: String): String;
begin
  Result := FirstExisting(ExpandConstant('{%USERPROFILE}\.local\bin\claude.exe'),
    ExpandConstant('{userappdata}\npm\claude.cmd'), ExpandConstant('{localappdata}\Programs\claude\claude.exe'));
end;

function CodePath(Param: String): String;
begin
  Result := FirstExisting(ExpandConstant('{localappdata}\Programs\Microsoft VS Code\Code.exe'),
    ExpandConstant('{commonpf64}\Microsoft VS Code\Code.exe'), '');
end;

function HasClaude: Boolean;
begin
  Result := ClaudePath('') <> '';
end;

function HasCode: Boolean;
begin
  Result := CodePath('') <> '';
end;

function HasLog: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\install.log'));
end;

function HasUserPython: Boolean;
var
  F: TFindRec;
begin
  Result := FindFirst(ExpandConstant('{localappdata}\Programs\Python\Python3*'), F);
  if Result then FindClose(F);
end;

function IsMissing(Tool: String): Boolean;
begin
  if Tool = 'node' then
    Result := not (OnPath('npx.cmd') or FileExists(ExpandConstant('{localappdata}\Programs\nodejs\npx.cmd')))
  else if Tool = 'git' then
    Result := not (OnPath('git.exe') or (FirstExisting(ExpandConstant('{localappdata}\Programs\Git\cmd\git.exe'),
      ExpandConstant('{commonpf64}\Git\cmd\git.exe'), '') <> ''))
  else if Tool = 'python' then
    Result := not (OnPath('py.exe') or HasUserPython or
      FileExists(ExpandConstant('{localappdata}\Python\bin\python.exe')))
  else if Tool = 'vscode' then
    Result := not (OnPath('code.cmd') or HasCode)
  else if Tool = 'claude' then
    Result := not (OnPath('claude.exe') or HasClaude)
  else
    Result := False;
end;

function ToolLabel(const Tool: String): String;
begin
  if Tool = 'node' then Result := 'Node.js'
  else if Tool = 'git' then Result := 'Git for Windows'
  else if Tool = 'python' then Result := 'Python 3'
  else if Tool = 'vscode' then Result := 'Visual Studio Code'
  else Result := 'Claude Code';
end;

// ── [PCODE-76 | S08 | v0.1.0] PATH as the registry has it now, so what was just installed is found ──
function ExpandEnv(const S: String): String;
var
  Buf: String;
  N: DWORD;
begin
  Buf := StringOfChar(' ', 32767);
  N := ExpandEnvironmentStrings(S, Buf, 32767);
  if N > 0 then Result := Copy(Buf, 1, N - 1) else Result := S;
end;

procedure RefreshPath;
var
  MachinePath, UserPath: String;
begin
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', MachinePath) then
    MachinePath := '';
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', UserPath) then
    UserPath := '';
  SetEnvironmentVariable('PATH', ExpandEnv(MachinePath + ';' + UserPath));
end;

// ── [PCODE-76 | S08 | v0.1.0] the Plane page: address, workspace, key (masked) or connect later ──
procedure InitializeWizard;
begin
  PlanePage := CreateInputQueryPage(wpSelectTasks, 'Connect to Plane',
    'Orqiva keeps its tasks in Plane.',
    'Paste a personal access token from Plane -> Profile -> Personal access tokens. ' +
    'It is stored encrypted for this Windows user only and is never written anywhere in clear text.');
  PlanePage.Add('Plane address:', False);
  PlanePage.Add('Workspace:', False);
  PlanePage.Add('API key:', True);
  PlanePage.Values[0] := 'https://plan.broszio.com';
  PlanePage.Values[1] := 'prodsystem';

  LaterBox := TNewCheckBox.Create(PlanePage);
  LaterBox.Parent := PlanePage.Surface;
  LaterBox.Top := PlanePage.Edits[2].Top + PlanePage.Edits[2].Height + ScaleY(16);
  LaterBox.Width := PlanePage.SurfaceWidth;
  LaterBox.Height := ScaleY(17);
  LaterBox.Caption := 'I will connect later (run Setup again or use PlaneClaude -> Connect)';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (PlanePage <> nil) and (CurPageID = PlanePage.ID) and not LaterBox.Checked then begin
    if Trim(PlanePage.Values[2]) = '' then begin
      MsgBox('Paste your Plane API key, or tick "I will connect later".', mbError, MB_OK);
      Result := False;
    end else if (Trim(PlanePage.Values[0]) = '') or (Trim(PlanePage.Values[1]) = '') then begin
      MsgBox('The Plane address and the workspace are needed with the key.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  Present: String;
  I: Integer;
  Tools: array[0..4] of String;
begin
  Tools[0] := 'node'; Tools[1] := 'git'; Tools[2] := 'python'; Tools[3] := 'vscode'; Tools[4] := 'claude';
  Present := '';
  for I := 0 to 4 do
    if not IsMissing(Tools[I]) then Present := Present + Space + ToolLabel(Tools[I]) + NewLine;
  Result := MemoDirInfo + NewLine + NewLine;
  if MemoTasksInfo <> '' then Result := Result + MemoTasksInfo + NewLine + NewLine;
  if Present <> '' then Result := Result + 'Already on this computer (left as it is):' + NewLine + Present + NewLine;
  Result := Result + 'Plane:' + NewLine + Space + PlanePage.Values[0] + ' / ' + PlanePage.Values[1] + NewLine;
  if LaterBox.Checked then Result := Result + Space + 'key: connect later' + NewLine
  else Result := Result + Space + 'key: given (stored encrypted)' + NewLine;
end;

// ── [PCODE-76 | S08 | v0.1.0] one step: hidden PowerShell, its name in the wizard, its result noted ──
function RunStep(const Caption, Script, Params: String): Integer;
var
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := Caption;
  WizardForm.FilenameLabel.Caption := 'Details go to ' + ExpandConstant('{app}\install.log');
  RefreshPath;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\bundle\install\') + Script + '" ' +
      Params + ' -LogFile "' + ExpandConstant('{app}\install.log') + '"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Log(Format('%s -> exit %d', [Script, Code]));
  Result := Code;
end;

function Clean(const S: String): String;
begin
  Result := Trim(S);
  StringChangeEx(Result, '"', '', True);
end;

procedure RunInstallSteps;
var
  I, Code: Integer;
  Tools: array[0..4] of String;
  Params, Key: String;
  Later: Boolean;
begin
  Failures := '';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  Tools[0] := 'node'; Tools[1] := 'git'; Tools[2] := 'python'; Tools[3] := 'vscode'; Tools[4] := 'claude';
  for I := 0 to 4 do
    if WizardIsTaskSelected(Tools[I]) then
      if RunStep('Installing ' + ToolLabel(Tools[I]) + '...', 'Install-Prerequisite.ps1', '-Tool ' + Tools[I]) <> 0 then
        Failures := Failures + '  - ' + ToolLabel(Tools[I]) + ' could not be installed' + #13#10;

  Params := '-InstallRoot "' + ExpandConstant('{app}') + '" -PlaneUrl "' + Clean(PlanePage.Values[0]) +
    '" -PlaneWorkspace "' + Clean(PlanePage.Values[1]) + '" -NonInteractive -SkipPrerequisites';
  if not WizardIsTaskSelected('extension') then Params := Params + ' -SkipExtension';
  Key := Trim(PlanePage.Values[2]);
  // a silent install may bring the key in its own environment; nothing to set then
  Later := LaterBox.Checked or ((Key = '') and (GetEnv('PLANE_API_KEY') = ''));
  if Later then Params := Params + ' -SkipCredentials'
  else if Key <> '' then SetEnvironmentVariable('PLANE_API_KEY', Key);
  try
    Code := RunStep('Installing the engine, the hooks and the extension...', 'Install-Orqiva.ps1', Params);
  finally
    if Key <> '' then DeleteEnvironmentVariable('PLANE_API_KEY', 0);
    Key := '';
    PlanePage.Values[2] := '';
  end;
  if Code = 1 then Failures := Failures + '  - the Orqiva engine was not installed (no usable Python)' + #13#10
  else if Code <> 0 then Failures := Failures + '  - Orqiva finished with warnings' + #13#10;
  if Later then Failures := Failures + '  - Plane is not connected yet: run Setup again with your key' + #13#10;

  RefreshPath;
  WizardForm.ProgressGauge.Style := npbstNormal;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then RunInstallSteps;
end;

// ── [PCODE-76 | S08 | v0.1.0] the finish page says what is left to do ──
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then begin
    if Failures <> '' then
      WizardForm.FinishedLabel.Caption :=
        'Orqiva is installed, but some steps need your attention:' + #13#10 + #13#10 + Failures + #13#10 +
        'The installation log has the details.'
    else
      WizardForm.FinishedLabel.Caption :=
        'Orqiva is installed.' + #13#10 + #13#10 +
        'Next: sign in to Claude Code once, then open a project folder in Visual Studio Code and ' +
        'click the Orqiva icon in the activity bar.';
    // the run list was placed under the default text; move it under ours
    WizardForm.AdjustLabelHeight(WizardForm.FinishedLabel);
    WizardForm.RunList.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(12);
  end;
end;
