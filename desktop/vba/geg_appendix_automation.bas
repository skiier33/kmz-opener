Attribute VB_Name = "GegAppendixAutomation"
Option Explicit

' Headless companions for KMZ GIS Viewer Appx PDF build (no FileDialog).

Public Sub InsertPictureOverCell_Auto(ByVal imgPath As String)
    Dim rng As Range
    Dim shp As Shape

    If Len(Trim$(imgPath)) = 0 Then Exit Sub
    If Dir$(imgPath) = "" Then Exit Sub

    Set rng = ActiveSheet.Range("B2")
    rng.Select

    Set shp = ActiveSheet.Shapes.AddPicture( _
        Filename:=imgPath, _
        LinkToFile:=msoFalse, _
        SaveWithDocument:=msoTrue, _
        Left:=rng.Left, _
        Top:=rng.Top, _
        Width:=-1, _
        Height:=-1)

    shp.Placement = xlMoveAndSize
End Sub

Public Sub InsertPicturePlaceInCell_Auto(ByVal imgPath As String)
    If Len(Trim$(imgPath)) = 0 Then Exit Sub
    If Dir$(imgPath) = "" Then Exit Sub

    ActiveSheet.Range("B2").Select
    ActiveCell.InsertPictureInCell imgPath
End Sub
