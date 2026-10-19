// Command reader reads and imports documents in the running Reader app.
//
// It talks to the app's loopback API through the server.json file that the
// app writes into its library directory, so the app must be open.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

var readerVersion = "dev"

const usage = `reader：在终端里读取和导入 Reader 书库中的文档（需要 Reader 正在运行）。

用法：
  reader <命令> [参数] [选项]

命令：
  status                         查看连接状态
  list                           列出文档
  show <文档>                    文档信息与摘要
  search <关键词…>               在全部文档的原文和译文中搜索
  read <文档>                    按页（PDF）或章节（EPUB）读取正文
  annotations <文档>             列出高亮、笔记和问题
  note <文档>                    读取论文笔记
  import <文件…>                 导入 PDF 或 EPUB

<文档> 可以是 ID、ID 前缀（如 list 显示的 8 位），或标题中的一段文字。
所有命令都支持 --json 输出，以及 --data <目录> 指定书库目录（也可设置 READER_DATA）。
运行 reader <命令> --help 查看该命令的选项。
`

func main() {
	err := run(os.Args[1:], os.Stdout)
	if err == nil {
		return
	}
	fmt.Fprintln(os.Stderr, "reader:", err)
	var exit exitError
	if errors.As(err, &exit) {
		os.Exit(exit.code)
	}
	os.Exit(1)
}

type command struct {
	summary string
	run     func(c *client, f *options, args []string, out io.Writer) error
	flags   func(fs *flag.FlagSet, f *options)
}

// options holds every command's flags; each command registers the ones it uses.
type options struct {
	json, allowLarge                          bool
	data, library, tag, folder, status, query string
	docType, kind, pages, chapters, side, doc string
	limit                                     int
}

var commands = map[string]command{
	"status":      {summary: "status", run: runStatus},
	"list":        {summary: "list [--library papers|books] [--type pdf|epub] [--tag 标签] [--folder 分类] [--status unread|reading|read] [--query 文字] [--limit N]", run: runList, flags: listFlags},
	"show":        {summary: "show <文档>", run: runShow},
	"search":      {summary: "search <关键词…> [--doc 文档] [--library papers|books] [--limit N]", run: runSearch, flags: searchFlags},
	"read":        {summary: "read <文档> [--pages 3-5] [--chapters 2] [--side source|translation|both]", run: runRead, flags: readFlags},
	"annotations": {summary: "annotations <文档> [--kind highlight|underline|note|question|bookmark]", run: runAnnotations, flags: annotationFlags},
	"note":        {summary: "note <文档>", run: runNote},
	"import":      {summary: "import <文件…> [--library papers|books] [--allow-large]", run: runImport, flags: importFlags},
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprint(out, usage)
		return nil
	}
	if args[0] == "version" || args[0] == "--version" {
		fmt.Fprintln(out, "reader", readerVersion)
		return nil
	}
	cmd, ok := commands[args[0]]
	if !ok {
		return usageError("未知命令 %q，运行 reader help 查看可用命令", args[0])
	}
	f := &options{}
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&f.json, "json", false, "以 JSON 输出")
	fs.StringVar(&f.data, "data", "", "书库目录")
	if cmd.flags != nil {
		cmd.flags(fs, f)
	}
	positional, err := parseInterleaved(fs, args[1:])
	if errors.Is(err, flag.ErrHelp) {
		fmt.Fprintf(out, "用法：reader %s\n\n选项：\n", cmd.summary)
		fs.SetOutput(out)
		fs.PrintDefaults()
		return nil
	}
	if err != nil {
		return usageError("%v\n用法：reader %s", err, cmd.summary)
	}
	c, err := connect(f.data)
	if err != nil {
		return err
	}
	return cmd.run(c, f, positional, out)
}

// parseInterleaved accepts options before, between and after positional
// arguments, as in `reader read 1a2b --pages 3`. "--" ends option parsing.
func parseInterleaved(fs *flag.FlagSet, args []string) ([]string, error) {
	positional := []string{}
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		rest := fs.Args()
		if len(rest) == 0 {
			return positional, nil
		}
		if len(args) > len(rest) && args[len(args)-len(rest)-1] == "--" {
			return append(positional, rest...), nil
		}
		positional = append(positional, rest[0])
		args = rest[1:]
	}
}

func oneDocument(args []string, name string) (string, error) {
	if len(args) != 1 {
		return "", usageError("用法：reader %s <文档>", name)
	}
	return args[0], nil
}

func trimLines(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
}
