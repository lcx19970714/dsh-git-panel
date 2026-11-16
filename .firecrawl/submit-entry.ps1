$ErrorActionPreference = 'Stop'
$branch = 'add-dsh-git-panel'
$entry = @'
url: https://github.com/lcx19970714/dsh-git-panel
name: lcx19970714/dsh-git-panel
category: git
description:
  en: 'Git panel for viewing diffs, editing files, staging and committing changes, and generating commit messages using models configured in DSH.'
  zh: 'Git 面板，支持查看差异、编辑文件、暂存与提交，并使用 DSH 中配置的模型生成提交说明。'
'@
$refBody = @{ ref = "refs/heads/$branch"; sha = 'af6a61860c808bf3b38bbbb929992374088337a0' } | ConvertTo-Json
$refBody | gh api repos/lcx19970714/awesome-dsh-plugin/git/refs --method POST --input -
if ($LASTEXITCODE -ne 0) { throw 'Failed to create submission branch' }
$body = @{ message = 'Add lcx19970714/dsh-git-panel'; branch = $branch; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($entry + "`n")) } | ConvertTo-Json
$body | gh api repos/lcx19970714/awesome-dsh-plugin/contents/data/plugins/lcx19970714__dsh-git-panel.yml --method PUT --input -
if ($LASTEXITCODE -ne 0) { throw 'Failed to commit catalog entry' }
