import { describe, expect, it } from "vitest";
import {
  SECTION_EXISTS_MESSAGE,
  filterSectionOptions,
  matchTextbook,
  outlinePointsBySection,
  outlineSectionNames,
  resolveSectionChoice,
  takenSectionNames,
} from "../sectionCatalog";

const books = [
  { subject: "数学", version: "人教版", volume: "必修第一册" },
  { subject: "数学", version: "人教版", volume: "必修第二册" },
  { subject: "数学", version: "湘教版", volume: "必修第一册" },
  { subject: "数学", version: "人教版", volume: "选择性必修第一册" },
];

describe("section catalog", () => {
  it("matches_a_generated_textbook_label_and_a_volume_only_label", () => {
    expect(matchTextbook(books, "数学", "人教版 必修第一册")?.volume).toBe("必修第一册");
    expect(matchTextbook(books, "数学", "人教版必修第一册")?.version).toBe("人教版");
    expect(matchTextbook(books, "数学", "必修第二册")?.volume).toBe("必修第二册");
    expect(matchTextbook(books, "物理", "人教版 必修第一册")).toBeNull();
  });

  it("match_textbook_maps_renjiao_a_and_task_title_to_required_volume", () => {
    const demo = matchTextbook(books, "数学", "人教A版", "数学必修一");
    expect(demo).toMatchObject({ version: "人教版", volume: "必修第一册" });
    expect(matchTextbook(books, "数学", "人教版", "数学必修二")?.volume).toBe("必修第二册");
    expect(matchTextbook(books, "数学", "人教A版", "选择性必修一")?.volume).toBe(
      "选择性必修第一册",
    );
    expect(matchTextbook(books, "数学", "人教版")).toBeNull();
    expect(matchTextbook(books, "数学", "必修第一册")).toBeNull();
  });

  it("resolve_section_choice_keeps_catalog_titles_and_trims_custom_names", () => {
    const catalog = outlineSectionNames({
      subject: "数学",
      version: "人教版",
      volume: "必修第一册",
      chapters: [
        {
          name: "第一章",
          sections: [{ name: "1.1 集合的概念" }, { name: " 1.2 集合间的基本关系 " }],
        },
      ],
    });
    expect(catalog).toEqual(["1.1 集合的概念", "1.2 集合间的基本关系"]);
    const taken = takenSectionNames(
      [{ section_name: "1.2 集合间的基本关系" }],
      [],
    );
    const filtered = filterSectionOptions(catalog, "集合");
    expect(
      resolveSectionChoice("1.1 集合的概念", catalog, taken, filtered, 0),
    ).toEqual({ kind: "catalog", name: "1.1 集合的概念" });
    expect(
      resolveSectionChoice("1.2 集合间的基本关系", catalog, taken, filtered, 0).kind,
    ).toBe("exists");
    expect(
      resolveSectionChoice("  补充专题  ", catalog, taken, [], 0, true),
    ).toEqual({ kind: "custom", name: "补充专题" });
    expect(SECTION_EXISTS_MESSAGE).toBe("该节已存在，请直接在内添加考点");
  });

  it("outline_points_by_section_trims_names_and_drops_blanks", () => {
    expect(
      outlinePointsBySection({
        subject: "数学",
        version: "人教版",
        volume: "必修第一册",
        chapters: [
          {
            name: "第一章",
            sections: [
              {
                name: " 1.1 集合的概念 ",
                knowledge_points: [" 集合的含义 ", "", "集合的含义", "元素与集合的关系"],
              },
              { name: "1.2 集合间的基本关系", knowledge_points: [] },
            ],
          },
        ],
      }),
    ).toEqual({
      "1.1 集合的概念": ["集合的含义", "元素与集合的关系"],
      "1.2 集合间的基本关系": [],
    });
  });
});