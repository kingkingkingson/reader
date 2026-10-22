package reader

import (
	"context"
	"strings"
	"unicode"
)

// Offsets map normalized characters back to the original target. Ignore only
// whitespace and full-width forms, never negations, numbers or math operators.
func recoveryCharacters(text string) ([]rune, []int, []rune) {
	original := []rune(text)
	chars := []rune{}
	offsets := []int{}
	for i, r := range original {
		if unicode.IsSpace(r) {
			continue
		}
		if r >= 0xff01 && r <= 0xff5e {
			r -= 0xfee0
		}
		chars = append(chars, r)
		offsets = append(offsets, i)
	}
	return chars, offsets, original
}
func matchRecoveryQuote(ctx context.Context, quote, target string) string {
	if quote == "" {
		return ""
	}
	if strings.Contains(target, quote) {
		return quote
	}
	needle, _, _ := recoveryCharacters(quote)
	haystack, offsets, original := recoveryCharacters(target)
	if len(needle) == 0 || len(haystack) == 0 {
		return ""
	}
	if i := strings.Index(string(haystack), string(needle)); i >= 0 {
		start := len([]rune(string(haystack)[:i]))
		return string(original[offsets[start] : offsets[start+len(needle)-1]+1])
	}
	numeric := true
	for _, r := range needle {
		if !unicode.IsDigit(r) && r != '.' && r != '-' && r != '%' {
			numeric = false
		}
	}
	// Tiny words and numbers must match exactly. Large selections fall back to
	// their source-aligned sentences instead of unbounded fuzzy computation.
	if len(needle) < 4 || numeric || len(needle) > 512 || len(haystack) > 32768 {
		return ""
	}
	previous := make([]int, len(haystack)+1)
	starts := make([]int, len(haystack)+1)
	for j := range starts {
		starts[j] = j
	}
	for i, r := range needle {
		if ctx.Err() != nil {
			return ""
		}
		row := make([]int, len(haystack)+1)
		nextStarts := make([]int, len(haystack)+1)
		row[0] = i + 1
		for j, c := range haystack {
			cost := 0
			if r != c {
				cost = 1
			}
			value, start := previous[j]+cost, starts[j]
			if previous[j+1]+1 < value {
				value, start = previous[j+1]+1, starts[j+1]
			}
			if row[j]+1 < value {
				value, start = row[j]+1, nextStarts[j]
			}
			row[j+1], nextStarts[j+1] = value, start
		}
		previous, starts = row, nextStarts
	}
	best := 0.6
	bestStart, bestEnd := -1, -1
	for end := 1; end <= len(haystack); end++ {
		start := starts[end]
		length := end - start
		if length == 0 || length*5 < len(needle)*3 || length*3 > len(needle)*5 {
			continue
		}
		score := 1 - float64(previous[end])/float64(max(len(needle), length))
		if score > best || (score == best && (bestStart < 0 || start < bestStart || (start == bestStart && absRecovery(length-len(needle)) < absRecovery(bestEnd-bestStart-len(needle))))) {
			best, bestStart, bestEnd = score, start, end
		}
	}
	if bestStart < 0 {
		return ""
	}
	return string(original[offsets[bestStart] : offsets[bestEnd-1]+1])
}
func bestRecoverySentence(ctx context.Context, quote string, sentences []TranslationSentence) int {
	best, index := -1.0, 0
	for i, sentence := range sentences {
		if ctx.Err() != nil {
			break
		}
		if quote != "" && strings.Contains(sentence.Target, quote) {
			return i
		}
		score := recoverySimilarity(ctx, quote, sentence.Target)
		if score > best {
			best, index = score, i
		}
	}
	return index
}
func recoverySimilarity(ctx context.Context, a, b string) float64 {
	left, _, _ := recoveryCharacters(a)
	right, _, _ := recoveryCharacters(b)
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	// Sentence selection is bounded even for malformed provider output.
	if len(left) > 2048 {
		left = left[:2048]
	}
	if len(right) > 2048 {
		right = right[:2048]
	}
	row := make([]int, len(right)+1)
	for j := range row {
		row[j] = j
	}
	for i, r := range left {
		if ctx.Err() != nil {
			return 0
		}
		next := make([]int, len(right)+1)
		next[0] = i + 1
		for j, c := range right {
			cost := 0
			if r != c {
				cost = 1
			}
			next[j+1] = min(row[j]+cost, row[j+1]+1, next[j]+1)
		}
		row = next
	}
	return 1 - float64(row[len(right)])/float64(max(len(left), len(right)))
}

func absRecovery(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
