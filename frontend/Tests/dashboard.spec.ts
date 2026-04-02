import { test, expect, Page } from "@playwright/test";

const DASHBOARD_URL = "http://localhost:3000/dashboard";

type DocumentResult = {
  doc_id: string;
  file_name?: string;
  status: string;
  processing_mode: number;
  text_length?: number;
  image_count?: number;
  removed_text_length?: number;
  error?: string;
  cached?: boolean;
  batch_id?: string;
};

type ComparisonResult = {
  doc_1: string;
  doc_2: string;
  combined_score: number;
  text_similarity: number;
  semantic_similarity: number;
  lexical_similarity: number;
  image_similarity: number;
  image_cosine_avg: number;
  image_phash_avg: number;
  matched_images: number;
  total_images: number;
  level: string;
  processing_mode: number;
};

type DashboardMockOptions = {
  latestBatchId?: string | null;
  initialDocs?: DocumentResult[];
  uploadResponseDocs?: DocumentResult[];
  compareResults?: ComparisonResult[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function makePdfFile(name: string) {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 mock pdf content"),
  };
}

function makeFakeJwt() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    })
  ).toString("base64");

  return `test.${payload}.test`;
}

async function seedSession(
  page: Page,
  options?: {
    batchId?: string;
    compareCache?: ComparisonResult[];
  }
) {
  const batchId = options?.batchId;
  const compareCache = options?.compareCache ?? null;
  const fakeJwt = makeFakeJwt();

  await page.addInitScript(
    ({ batchId, compareCache, fakeJwt }) => {
      sessionStorage.setItem("access_token", fakeJwt);

      if (batchId) {
        sessionStorage.setItem("last_batch_id", batchId);
      }

      if (batchId && compareCache) {
        sessionStorage.setItem(
          `compare_cache:${batchId}`,
          JSON.stringify(compareCache)
        );
        sessionStorage.setItem(
          "last_compare_results",
          JSON.stringify(compareCache)
        );
        sessionStorage.setItem("last_compare_batch_id", batchId);
      }
    },
    { batchId, compareCache, fakeJwt }
  );
}

async function mockDashboardApi(page: Page, options?: DashboardMockOptions) {
  let docs = clone(options?.initialDocs ?? []);
  const latestBatchId = options?.latestBatchId ?? null;
  const uploadResponseDocs = clone(options?.uploadResponseDocs ?? []);
  const compareResults = clone(options?.compareResults ?? []);

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

  await page.route(/\/batches\/latest(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ batch_id: latestBatchId }),
    });
  });

  await page.route(/\/documents\/[^/?]+(\?.*)?$/, async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const pathnameParts = url.pathname.split("/");
    const lastPart = pathnameParts[pathnameParts.length - 1];

    if (method === "DELETE") {
      docs = docs.filter((d) => d.doc_id !== decodeURIComponent(lastPart));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://example.com/mock.pdf" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/documents(\?.*)?$/, async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(docs),
      });
      return;
    }

    if (method === "DELETE") {
      docs = [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/upload-pdfs(\?.*)?$/, async (route) => {
    if (uploadResponseDocs.length > 0) {
      docs = clone(uploadResponseDocs);
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: uploadResponseDocs,
      }),
    });
  });

  await page.route(/\/compare(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(compareResults),
    });
  });
}

test.describe("Dashboard Page", () => {
  test("เปิดหน้า dashboard และเห็นส่วนอัปโหลดไฟล์", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page);

    await page.goto(DASHBOARD_URL);

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText("อัปโหลดไฟล์ PDF")).toBeVisible();
    await expect(page.getByText("โหมดการประมวลผล")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ข้อความเท่านั้น" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "รูปภาพเท่านั้น" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ข้อความ + รูปภาพ" })
    ).toBeVisible();
    await expect(page.getByTestId("upload-button")).toBeVisible();
    await expect(page.getByText("ยังไม่มีเอกสาร")).toBeVisible();
  });

  test("อัปโหลดไฟล์ PDF ได้สำเร็จ", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page, {
      uploadResponseDocs: [
        {
          doc_id: "doc_001",
          file_name: "test1.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
    });

    await page.goto(DASHBOARD_URL);

    await page
      .getByTestId("upload-input")
      .setInputFiles(makePdfFile("test1.pdf"));

    await expect(page.getByText("เลือกแล้ว 1 ไฟล์")).toBeVisible();

    await page.getByTestId("upload-button").click();

    await expect(page.getByTestId("upload-success-modal")).toBeVisible();
    await expect(page.getByText("อัปโหลดสำเร็จ!")).toBeVisible();
    await expect(
      page.getByTestId("upload-success-modal").getByText("test1.pdf")
    ).toBeVisible();
  });

  test("เปิดใช้ Template และอัปโหลดไฟล์ Template ได้", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page, {
      uploadResponseDocs: [
        {
          doc_id: "doc_001",
          file_name: "answer1.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
    });

    await page.goto(DASHBOARD_URL);

    await page.locator("#useTemplate").check();

    await expect(
      page.getByText("วางไฟล์ Template PDF หรือคลิกเพื่อเลือก")
    ).toBeVisible();

    await page
      .getByTestId("template-input")
      .setInputFiles(makePdfFile("template.pdf"));

    await page
      .getByTestId("upload-input")
      .setInputFiles(makePdfFile("answer1.pdf"));

    await expect(page.getByText("template.pdf")).toBeVisible();
    await expect(page.getByText("เลือกแล้ว 1 ไฟล์")).toBeVisible();

    await page.getByTestId("upload-button").click();

    await expect(page.getByTestId("upload-success-modal")).toBeVisible();
    await expect(
      page.getByTestId("upload-success-modal").getByText("answer1.pdf")
    ).toBeVisible();
  });

  test("ถ้าเลือกใช้ Template แต่ยังไม่ใส่ไฟล์ Template ปุ่มอัปโหลดต้อง disabled", async ({
    page,
  }) => {
    await seedSession(page);
    await mockDashboardApi(page);

    await page.goto(DASHBOARD_URL);

    await page.locator("#useTemplate").check();
    await page
      .getByTestId("upload-input")
      .setInputFiles(makePdfFile("test1.pdf"));

    await expect(page.getByTestId("upload-button")).toBeDisabled();
  });

  test("เลือกโหมดรูปภาพแล้ว Template ต้องถูกปิดใช้งาน", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page);

    await page.goto(DASHBOARD_URL);

    await page.getByRole("button", { name: "รูปภาพเท่านั้น" }).click();

    await expect(page.locator("#useTemplate")).toBeDisabled();
    await expect(
      page.getByText("โหมดรูปภาพเท่านั้นไม่รองรับ Template")
    ).toBeVisible();
  });

  test("ถ้าเอกสารน้อยกว่า 2 ไฟล์ ปุ่มเปรียบเทียบต้อง disabled", async ({
    page,
  }) => {
    await seedSession(page);
    await mockDashboardApi(page, {
      latestBatchId: "batch_001",
      initialDocs: [
        {
          doc_id: "doc_001",
          file_name: "one.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
    });

    await page.goto(DASHBOARD_URL);

    await expect(page.getByText("1 ไฟล์พร้อมเปรียบเทียบ")).toBeVisible();
    await expect(page.getByText("ต้องมีอย่างน้อย 2 เอกสาร")).toBeVisible();
    await expect(page.getByTestId("compare-button")).toBeDisabled();
  });

  test("กดเปรียบเทียบเอกสารได้เมื่อมีอย่างน้อย 2 ไฟล์", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page, {
      latestBatchId: "batch_001",
      initialDocs: [
        {
          doc_id: "doc_001",
          file_name: "test1.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
        {
          doc_id: "doc_002",
          file_name: "test2.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
      compareResults: [
        {
          doc_1: "doc_001",
          doc_2: "doc_002",
          combined_score: 0.92,
          text_similarity: 0.95,
          semantic_similarity: 0.93,
          lexical_similarity: 0.9,
          image_similarity: 0,
          image_cosine_avg: 0,
          image_phash_avg: 0,
          matched_images: 0,
          total_images: 0,
          level: "คล้ายระดับสูง",
          processing_mode: 1,
        },
      ],
    });

    await page.goto(DASHBOARD_URL);

    await expect(page.getByText("2 ไฟล์พร้อมเปรียบเทียบ")).toBeVisible();
    await expect(page.getByTestId("compare-button")).toBeEnabled();

    await page.getByTestId("compare-button").click();

    await expect(
      page.getByRole("heading", { name: "ผลการเปรียบเทียบ" })
    ).toBeVisible();
    await expect(page.getByText("92.00%")).toBeVisible();
    await expect(
      page.locator("span").filter({ hasText: "คล้ายระดับสูง" }).first()
    ).toBeVisible();
  });

  test("โหลด compare cache เดิมแล้วเปิดแท็บผลการเปรียบเทียบทันที", async ({
    page,
  }) => {
    const compareCache: ComparisonResult[] = [
      {
        doc_1: "doc_001",
        doc_2: "doc_002",
        combined_score: 0.88,
        text_similarity: 0.9,
        semantic_similarity: 0.87,
        lexical_similarity: 0.85,
        image_similarity: 0,
        image_cosine_avg: 0,
        image_phash_avg: 0,
        matched_images: 0,
        total_images: 0,
        level: "คล้ายระดับกลาง",
        processing_mode: 1,
      },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockDashboardApi(page, {
      latestBatchId: "batch_001",
      initialDocs: [
        {
          doc_id: "doc_001",
          file_name: "cached1.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
        {
          doc_id: "doc_002",
          file_name: "cached2.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
      compareResults: compareCache,
    });

    await page.goto(DASHBOARD_URL);

    await expect(page).toHaveURL(/dashboard/);
    await expect(
      page.getByRole("heading", { name: "ผลการเปรียบเทียบ" })
    ).toBeVisible();

    const cachedCard = page
      .locator("div.border.rounded-xl.p-4")
      .filter({ hasText: "cached1.pdf" })
      .first();

    await expect(cachedCard).toContainText("cached1.pdf");
    await expect(cachedCard).toContainText("cached2.pdf");
    await expect(cachedCard).toContainText("88.00%");
  });

  test("กรองผลตามระดับความคล้ายได้", async ({ page }) => {
    const compareCache: ComparisonResult[] = [
      {
        doc_1: "doc_001",
        doc_2: "doc_002",
        combined_score: 0.95,
        text_similarity: 0.96,
        semantic_similarity: 0.95,
        lexical_similarity: 0.94,
        image_similarity: 0,
        image_cosine_avg: 0,
        image_phash_avg: 0,
        matched_images: 0,
        total_images: 0,
        level: "คล้ายระดับสูง",
        processing_mode: 1,
      },
      {
        doc_1: "doc_003",
        doc_2: "doc_004",
        combined_score: 0.82,
        text_similarity: 0.84,
        semantic_similarity: 0.83,
        lexical_similarity: 0.8,
        image_similarity: 0,
        image_cosine_avg: 0,
        image_phash_avg: 0,
        matched_images: 0,
        total_images: 0,
        level: "คล้ายระดับกลาง",
        processing_mode: 1,
      },
      {
        doc_1: "doc_005",
        doc_2: "doc_006",
        combined_score: 0.71,
        text_similarity: 0.72,
        semantic_similarity: 0.71,
        lexical_similarity: 0.7,
        image_similarity: 0,
        image_cosine_avg: 0,
        image_phash_avg: 0,
        matched_images: 0,
        total_images: 0,
        level: "คล้ายระดับต่ำ",
        processing_mode: 1,
      },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockDashboardApi(page, {
      latestBatchId: "batch_001",
      initialDocs: [
        {
          doc_id: "doc_001",
          file_name: "a.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
        {
          doc_id: "doc_002",
          file_name: "b.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
      compareResults: compareCache,
    });

    await page.goto(DASHBOARD_URL);

    await expect(
      page.getByRole("heading", { name: "ผลการเปรียบเทียบ" })
    ).toBeVisible();

    const resultCards = page.locator("div.border.rounded-xl.p-4");
    await expect(resultCards).toHaveCount(3);

    await page.getByRole("button", { name: /^คล้ายระดับสูง/ }).first().click();

    await expect(resultCards).toHaveCount(1);

    const onlyCard = resultCards.first();
    await expect(onlyCard).toContainText("a.pdf");
    await expect(onlyCard).toContainText("b.pdf");
    await expect(onlyCard).toContainText("คล้ายระดับสูง");
  });

  test("ลบเอกสารทั้งหมดได้", async ({ page }) => {
    await seedSession(page);
    await mockDashboardApi(page, {
      latestBatchId: "batch_001",
      initialDocs: [
        {
          doc_id: "doc_001",
          file_name: "test1.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
        {
          doc_id: "doc_002",
          file_name: "test2.pdf",
          status: "success",
          processing_mode: 1,
          batch_id: "batch_001",
        },
      ],
    });

    await page.goto(DASHBOARD_URL);

    await expect(page.getByText("2 ไฟล์พร้อมเปรียบเทียบ")).toBeVisible();

    let dialogCount = 0;

    page.on("dialog", async (dialog) => {
    dialogCount += 1;
    await dialog.accept();
    });

    await page.getByRole("button", { name: /ลบเอกสารทั้งหมด/ }).click();

    await expect.poll(() => dialogCount).toBe(2);
    await expect(page.getByText("ยังไม่มีเอกสาร")).toBeVisible();
    });
  });