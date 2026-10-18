!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
!macro customPageAfterChangeDir
Var TideConfirmDialog
  Page custom TideConfirmPage
Function TideConfirmPage
  loopTrim:
    StrCpy $0 "$INSTDIR" 1 -1
    StrCmp $0 "\" 0 trimDone
    StrCpy $INSTDIR "$INSTDIR" -1
    Goto loopTrim
  trimDone:
  ${GetFileName} "$INSTDIR" $0
  StrCmp $0 "Tide" normalized
  StrCpy $INSTDIR "$INSTDIR\Tide"
  normalized:
  !insertmacro MUI_HEADER_TEXT "准备安装 Tide" "请确认安装位置，然后点击安装。"
  nsDialogs::Create 1018
  Pop $TideConfirmDialog
  ${If} $TideConfirmDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 8u 100% 24u "即将安装到以下文件夹："
  Pop $0
  ${NSD_CreateLabel} 0 40u 100% 48u "$INSTDIR"
  Pop $0
  ${NSD_CreateLabel} 0 100u 100% 28u "如需更改位置，请点击上一步。"
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装(&I)"
  nsDialogs::Show
FunctionEnd

!macroend
