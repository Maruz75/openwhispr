/*
 Adapted from OpenWhispr src/utils/correctionLearner.js.
 MIT License — Copyright (c) 2024 OpenWhispr Team

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import Foundation

/// Conservative local vocabulary learning, independent of remote model selection.
/// Whole rewrites, inserted phrases, punctuation and ordinary content edits are ignored.
enum CorrectionLearner {
    private static let commonWords = Set(("the and for not with you this but his from they say her she will one all would there their what out about who get which when make can like time just him know take into year your good some could them see other than then now look only come over think also back after use two how our work first well way even new want because any these give day most are was were been has had did does said went made got came took saw knew thought where why here very much many still too again off down never every own same another both each few more less last next while before through under between should might must being have that its yes okay saya aku kamu anda kita kami dia mereka ini itu yang dan atau dengan dari untuk pada adalah akan sudah belum tidak bukan bisa saja juga kalau karena tetapi lalu oleh dalam jadi apa mana kapan bagaimana baik iya ada ke di si nya").split(separator: " ").map(String.init))

    static func extract(original: String, edited: String, existing: [DictionaryEntry]) -> [DictionaryEntry] {
        guard !original.isEmpty, !edited.isEmpty, original != edited else { return [] }
        let before = tokenize(original)
        let after = tokenize(edited)
        // Bound quadratic LCS work; long transcripts are edited without automatic learning.
        guard !before.isEmpty, !after.isEmpty, before.count <= 600, after.count <= 600 else { return [] }
        let lowerBefore = before.map { $0.lowercased() }
        let lowerAfter = after.map { $0.lowercased() }
        var lengths = Array(repeating: Array(repeating: 0, count: after.count + 1), count: before.count + 1)
        for i in 1...before.count {
            for j in 1...after.count {
                lengths[i][j] = lowerBefore[i - 1] == lowerAfter[j - 1]
                    ? lengths[i - 1][j - 1] + 1 : max(lengths[i - 1][j], lengths[i][j - 1])
            }
        }
        // Require stable surrounding context, including when a rewrite contains insertions.
        let overlap = lengths[before.count][after.count]
        let singleWordCorrection = before.count == 1 && after.count == 1
        guard singleWordCorrection || overlap >= max(1, Int(ceil(Double(max(before.count, after.count)) * 0.5))) else { return [] }
        var aligned: [(String?, String?)] = []
        var i = before.count
        var j = after.count
        while i > 0 || j > 0 {
            if i > 0, j > 0, lowerBefore[i - 1] == lowerAfter[j - 1] {
                aligned.append((before[i - 1], after[j - 1])); i -= 1; j -= 1
            } else if j > 0, i == 0 || lengths[i][j - 1] >= lengths[i - 1][j] {
                aligned.append((nil, after[j - 1])); j -= 1
            } else {
                aligned.append((before[i - 1], nil)); i -= 1
            }
        }
        aligned.reverse()
        var seen = Set(existing.map { $0.source.lowercased() + "→" + $0.replacement.lowercased() })
        var result: [DictionaryEntry] = []
        var cursor = 0
        while cursor < aligned.count {
            if aligned[cursor].0 != nil, aligned[cursor].1 != nil { cursor += 1; continue }
            let start = cursor
            while cursor < aligned.count, aligned[cursor].0 == nil || aligned[cursor].1 == nil { cursor += 1 }
            // Only one deletion and one insertion in a change block are a lexical correction.
            let block = aligned[start..<cursor]
            let removed = block.compactMap { $0.0 }
            let inserted = block.compactMap { $0.1 }
            guard removed.count == 1, inserted.count == 1 else { continue }
            let source = removed[0]
            let replacement = inserted[0]
            let a = source.lowercased(), b = replacement.lowercased()
            let key = a + "→" + b
            guard a != b, replacement.count >= 3, !commonWords.contains(b), !seen.contains(key),
                  Double(distance(a, b)) / Double(max(a.count, b.count)) <= 0.65 else { continue }
            let entry = DictionaryEntry(source: source, replacement: replacement, learned: true)
            guard entry.isValidContext else { continue }
            result.append(entry)
            seen.insert(key)
        }
        return result
    }

    static func tokenize(_ value: String) -> [String] {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        return value.split(whereSeparator: { $0.isWhitespace }).map {
            String($0).trimmingCharacters(in: allowed.inverted)
        }.filter { !$0.isEmpty }
    }

    static func distance(_ first: String, _ second: String) -> Int {
        let a = Array(first), b = Array(second)
        var previous = Array(0...b.count)
        for (i, letter) in a.enumerated() {
            var current = [i + 1] + Array(repeating: 0, count: b.count)
            for (j, other) in b.enumerated() {
                current[j + 1] = min(previous[j + 1] + 1, current[j] + 1, previous[j] + (letter == other ? 0 : 1))
            }
            previous = current
        }
        return previous[b.count]
    }
}
