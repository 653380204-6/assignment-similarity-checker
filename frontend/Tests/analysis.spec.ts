import { test, expect, Page } from "@playwright/test";

const ANALYSIS_URL = "http://localhost:3000/analysis";

type CompareItem = {
  doc_1: string;
  doc_2: string;
  combined_score?: number;
  final_score?: number;
};

type DocItem = {
  doc_id: string;
  file_name?: string;
};

function makeFakeJwt() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    })
  ).toString("base64");

  return `test.${payload}.test`;
}

function makeMockDendro() {
  return {
    method: "single",
    leaf_order: ["doc_001", "doc_002", "doc_003", "doc_004"],
    icoord: [
      [5, 5, 15, 15],
      [25, 25, 35, 35],
      [10, 10, 30, 30],
    ],
    dcoord: [
      [0, 0.05, 0.05, 0],
      [0, 0.09, 0.09, 0],
      [0.05, 0.2, 0.2, 0.09],
    ],
  };
}

async function seedSession(
  page: Page,
  options?: {
    batchId?: string | null;
    compareCache?: CompareItem[] | null;
    lastCompareResults?: CompareItem[] | null;
  }
) {
  const fakeJwt = makeFakeJwt();
  const batchId = options?.batchId ?? null;
  const compareCache = options?.compareCache ?? null;
  const lastCompareResults = options?.lastCompareResults ?? null;

  await page.addInitScript(
    ({ fakeJwt, batchId, compareCache, lastCompareResults }) => {
      sessionStorage.setItem("access_token", fakeJwt);

      if (batchId) {
        sessionStorage.setItem("last_batch_id", batchId);
      }

      if (batchId && compareCache) {
        sessionStorage.setItem(
          `compare_cache:${batchId}`,
          JSON.stringify(compareCache)
        );
        sessionStorage.setItem("last_compare_batch_id", batchId);
      }

      if (lastCompareResults) {
        sessionStorage.setItem(
          "last_compare_results",
          JSON.stringify(lastCompareResults)
        );
      }
    },
    { fakeJwt, batchId, compareCache, lastCompareResults }
  );
}

async function mockAnalysisApis(
  page: Page,
  options?: {
    docs?: DocItem[];
    compareResults?: CompareItem[];
    dendroResponse?: any;
  }
) {
  const docs: DocItem[] =
    options?.docs ??
    [
      { doc_id: "doc_001", file_name: "alpha.pdf" },
      { doc_id: "doc_002", file_name: "beta.pdf" },
      { doc_id: "doc_003", file_name: "gamma.pdf" },
      { doc_id: "doc_004", file_name: "delta.pdf" },
    ];

  const compareResults: CompareItem[] =
    options?.compareResults ??
    [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

  const dendroResponse = options?.dendroResponse ?? makeMockDendro();

  await page.route(/\/auth\/me(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_001",
        email: "test@example.com",
        name: "Test User",
      }),
    });
  });

  await page.route(/\/documents(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(docs),
    });
  });

  await page.route(/\/compare(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(compareResults),
    });
  });

  await page.route(/\/dendrogram$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dendroResponse),
    });
  });
}

test.describe("Analysis Page", () => {
  test("เปิดหน้า analysis ได้และเห็นส่วนควบคุมหลัก", async ({ page }) => {
    await seedSession(page, { batchId: "batch_001" });
    await mockAnalysisApis(page);

    await page.goto(ANALYSIS_URL);

    await expect(page).toHaveURL(/analysis/);

    const thresholdInput = page.locator('input[type="text"]').first();
    await expect(thresholdInput).toBeVisible();

    await expect(
      page.getByRole("heading", {
        name: "กราฟแสดงผลการเปลี่ยนแปลงจำนวนเอกสารตาม Threshold",
      })
    ).toBeVisible();

    await expect(
      page.getByRole("heading", {
        name: "กราฟกิ่งไม้การจัดกลุ่มของเอกสาร",
      })
    ).toBeVisible();

    const statsBox = page.locator("div.bg-gray-50.rounded-md").first();

    await expect(
      statsBox.locator("span.font-medium").filter({ hasText: "จำนวนเอกสาร" })
    ).toBeVisible();

    await expect(
      statsBox.locator("span.font-medium").filter({ hasText: "จำนวนคู่เอกสาร" })
    ).toBeVisible();
  });

  test("ไม่มี compare cache ต้องโหลดผลเปรียบเทียบอัตโนมัติและตั้ง threshold กลางให้", async ({
    page,
  }) => {
    await seedSession(page, { batchId: "batch_001" });
    await mockAnalysisApis(page, {
      docs: [
        { doc_id: "doc_001", file_name: "alpha.pdf" },
        { doc_id: "doc_002", file_name: "beta.pdf" },
        { doc_id: "doc_003", file_name: "gamma.pdf" },
        { doc_id: "doc_004", file_name: "delta.pdf" },
      ],
      compareResults: [
        { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
        { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
        { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
      ],
    });

    await page.goto(ANALYSIS_URL);

    const thresholdInput = page.locator('input[type="text"]').first();

    await expect(thresholdInput).toHaveValue("0.92");

    const statsBox = page.locator("div.bg-gray-50.rounded-md").first();
    await expect(statsBox).toContainText("จำนวนเอกสาร");
    await expect(statsBox).toContainText("4");
    await expect(statsBox).toContainText("จำนวนคู่เอกสาร");
    await expect(statsBox).toContainText("3");

    await expect(
      page.locator("button").filter({ hasText: "0.78" }).first()
    ).toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "0.92" }).first()
    ).toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "0.94" }).first()
    ).toBeVisible();
  });

  test("กดค่าแนะนำ threshold แล้วค่าใน input เปลี่ยน", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockAnalysisApis(page);

    await page.goto(ANALYSIS_URL);

    const thresholdInput = page.locator('input[type="text"]').first();

    await expect(thresholdInput).toHaveValue("0.92");

    await page.locator("button").filter({ hasText: "0.78" }).first().click();
    await expect(thresholdInput).toHaveValue("0.78");

    await page.locator("button").filter({ hasText: "0.94" }).first().click();
    await expect(thresholdInput).toHaveValue("0.94");
  });

  test("กรอก threshold เองแล้ว blur ต้อง normalize ค่าได้", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockAnalysisApis(page);

    await page.goto(ANALYSIS_URL);

    const thresholdInput = page.locator('input[type="text"]').first();

    await thresholdInput.fill("1.20");
    await page.locator("body").click();
    await expect(thresholdInput).toHaveValue("1.00");

    await thresholdInput.fill("-2");
    await page.locator("body").click();
    await expect(thresholdInput).toHaveValue("0.00");
  });

  test("มีข้อมูลแล้วต้องโหลด dendrogram และเปิด modal เต็มจอได้", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockAnalysisApis(page);

    await page.goto(ANALYSIS_URL);

    const expandButton = page.getByTitle("ขยายดูเต็มจอ");
    await expect(expandButton).toBeEnabled();

    await expandButton.click();

    await expect(
      page.getByText("ดูโครงสร้างการรวมกลุ่มของเอกสารได้ละเอียดมากขึ้น")
    ).toBeVisible();

    await page.getByTitle("ปิด").click();

    await expect(
      page.getByText("ดูโครงสร้างการรวมกลุ่มของเอกสารได้ละเอียดมากขึ้น")
    ).not.toBeVisible();
  });

  test("ไม่มีข้อมูลพอจะแสดงกราฟต้องขึ้น empty state", async ({ page }) => {
    await seedSession(page, { batchId: "batch_001" });

    await mockAnalysisApis(page, {
      docs: [],
      compareResults: [],
      dendroResponse: null,
    });

    await page.goto(ANALYSIS_URL);

    await expect(
      page.getByText("ยังไม่มีข้อมูลพอสำหรับแสดงกราฟ threshold sweep")
    ).toBeVisible();

    await expect(
      page.getByText("ยังไม่มีข้อมูลสำหรับแสดงกราฟกิ่งไม้")
    ).toBeVisible();

    await expect(page.getByTitle("ขยายดูเต็มจอ")).toBeDisabled();
  });
});