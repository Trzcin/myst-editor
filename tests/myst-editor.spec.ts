import { ChangeSpec } from '@codemirror/state';
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { EditorView } from 'codemirror';

declare global {
    interface Window {
        myst_editor: {
            text: string,
            main_editor: EditorView
        };
    }
}

test.describe.parallel("With collaboration disabled", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector(".cm-content");
    });

    test('Loads initial document', async ({ page }) => {
        const editorContent = await page.evaluate(() => window.myst_editor.text);
        expect(editorContent)
            .toMatch(/^# h1 is quite big/);
        expect(editorContent.indexOf(editorContent.slice(0, 20)))
            .toBe(editorContent.lastIndexOf(editorContent.slice(0, 20))); // Assert that content isn't duplicated
    });

    test('Caches async transforms', async ({ page }) => {
        await clearEditor(page);
        const todayDate = new Date().toLocaleString('en-GB', { timeZone: 'UTC' }).split(" ")[0];

        // |date| gets transformed for the first time
        await insertChangesAndCheckOutput(
            page,
            {
                from: 0,
                insert: "blah blah |date| blah blah",
            },
            (html) => expect(html).toContain(todayDate)
        );

        // Find out what the transform has returned
        const previewContent = await page.locator(".myst-preview").first().textContent() as string;
        const time = previewContent.split(" ")[3];

        await page.waitForTimeout(2000)

        // Assert that the next |date| returns the same time as the first one 
        await clearEditor(page);
        await insertChangesAndCheckOutput(
            page,
            {
                from: 0,
                insert: "blah blah |date| blah blah",
            },
            (html) => expect(html).toContain(time)
        );

        // But if we click the refresh button then the transform will be updated and output will be different
        await page.getByTitle("Refresh issue links").click();
        await insertChangesAndCheckOutput(
            page,
            null,
            (html) => expect(html).not.toContain(time)
        );

    });

    test.describe("Renders input", () => {
        [1, 2, 3].forEach(header => {
            test('Renders header: ' + header, async ({ page }) => {
                await clearEditor(page);
                await insertChangesAndCheckOutput(
                    page,
                    {
                        from: 0,
                        insert: "#".repeat(header) + " Some title",
                    },
                    (html) => expect(html).toContain(`<h${header}>Some title`)
                )
            });
        })

        test('Renders synchronous transforms', async ({ page }) => {
            await clearEditor(page);
            await insertChangesAndCheckOutput(
                page,
                {
                    from: 0,
                    insert: "blah blah @some-user blah  blah ",
                },
                (html) => expect(html).toContain(`<a href="https://github.com/some-user">`)
            )
        });

        test('Renders async transforms', async ({ page }) => {
            const today = new Date().toLocaleString('en-GB', { timeZone: 'UTC' });
            const [date, time] = today.split(" ");
            await clearEditor(page);
            await insertChangesAndCheckOutput(
                page,
                {
                    from: 0,
                    insert: "blah blah |date| blah blah",
                },
                (html) => expect(html).toContain(date)
            )
        });

        test('Renders custom roles', async ({ page }) => {
            await clearEditor(page);
            await insertChangesAndCheckOutput(
                page,
                {
                    from: 0,
                    insert: "blah blah {say}`something` blah blah",
                },
                (html) => expect(html).toContain(" says: 'something'")
            )
        });
    })
})

test.describe.parallel("With collaboration enabled", () => {
    test('Keeps the initial document if collaborative state is empty', async ({ context }) => {
        const collabOpts = { collab_server: "ws://localhost:4455", collab: "true", room: Date.now().toString() };
        const page = await openPageWithOpts(context, collabOpts);

        const editorContent = await page.evaluate(() => window.myst_editor.text);
        expect(editorContent)
            .toMatch(/^# h1 is quite big/);
        expect(editorContent.indexOf(editorContent.slice(0, 20)))
            .toBe(editorContent.lastIndexOf(editorContent.slice(0, 20))); // Assert that content isn't duplicated
    });

    test('Rejects the initial document if collaborative state is not empty', async ({ context }) => {
        const collabOpts = { collab_server: "ws://localhost:4455", collab: "true", room: Date.now().toString() };
        const pageA = await openPageWithOpts(context, collabOpts);

        // Initialize the document from pageA
        await clearEditor(pageA);
        await insertChangesAndCheckOutput(
            pageA,
            { from: 0, insert: "Some content" },
            (html) => expect(html).toContain("Some content")
        );
        await pageA.close();

        // Open the document as another user and verify that the initial content was ignored
        const pageB = await openPageWithOpts(context, collabOpts);
        const editorContent = await pageB.evaluate(() => window.myst_editor.text);

        expect(editorContent).not.toContain("# h1 is quite big");
        expect(editorContent).toContain("Some content");
        expect(editorContent.indexOf("Some content")).toBe(editorContent.lastIndexOf("Some content")); // Assert that content isn't duplicated
    });

    test('Synces document between peers', async ({ context }) => {
        const collabOpts = defaultCollabOpts();
        const pageA = await openPageWithOpts(context, collabOpts);

        // Initialize the document from pageA and add some content
        await clearEditor(pageA);
        await insertChangesAndCheckOutput(
            pageA,
            { from: 0, insert: "This is from pageA!" },
            (html) => expect(html).toContain("This is from pageA!")
        );

        // Open the document as another user and add some content
        const pageB = await openPageWithOpts(context, collabOpts);
        const currentText = await pageB.evaluate(() => window.myst_editor.text);
        expect(currentText).toBe("This is from pageA!");

        await insertChangesAndCheckOutput(
            pageB, {
            from: currentText.length,
            insert: "And this is from pageB!"
        }, (html) => {
            // Verify that both contents are present
            expect(html).toContain("This is from pageA!");
            expect(html).toContain("And this is from pageB!");
        })
    });

    test.describe("Comments", () => {
        test('Positions are synced', async ({ context }) => {
            const collabOpts = defaultCollabOpts();
            const pageA = await openPageWithOpts(context, collabOpts);
            const pageB = await openPageWithOpts(context, collabOpts);

            // Initialize the document from pageA and add some content
            await clearEditor(pageA);
            await insertChangesAndCheckOutput(
                pageA,
                { from: 0, insert: "Line1\nLine2\nLine3\nLine4" },
                (html) => expect(html).toContain("Line4")
            );

            // Add a comment from pageA
            const placesForCommentA = await pageA.locator(".comment-gutter-icon").all();
            expect(placesForCommentA.length).toBe(5)
            await placesForCommentA[2].hover();
            await placesForCommentA[2].click();

            // Confirm that comment was added
            expect(await pageA.locator(".comment-wrapper").count()).toBe(1);
            expect(await pageB.locator(".comment-wrapper").count()).toBe(1);

            // Remove the comment from pageB
            await pageB.locator(".comment-gutter-icon.comment-image").hover();
            await pageB.getByText("DELETE").click();

            // Verify that comment was removed on both peers
            expect(await pageB.locator(".comment-wrapper").count()).toBe(0);
            expect(await pageA.locator(".comment-wrapper").count()).toBe(0);
        });

        test('Can be dragged', async ({ context }) => {
            const collabOpts = defaultCollabOpts();
            const pageA = await openPageWithOpts(context, collabOpts);
            const pageB = await openPageWithOpts(context, collabOpts);

            // Initialize the document from pageA and add some content
            await clearEditor(pageA);
            await insertChangesAndCheckOutput(
                pageA,
                { from: 0, insert: "Line1\nLine2\nLine3\nLine4" },
                (html) => expect(html).toContain("Line4")
            );

            // Add a comment from pageA
            const placesForCommentA = await pageA.locator(".comment-gutter-icon").all();
            expect(placesForCommentA.length).toBe(5)
            await placesForCommentA[1].hover();
            await placesForCommentA[1].click();

            // Drag the comment
            const from = await pageA.locator(".comment-icon").boundingBox() as
                { x: number; y: number; width: number; height: number; };
            const to = await placesForCommentA[3].boundingBox() as
                { x: number; y: number; width: number; height: number; };
            await pageA.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
            await pageA.mouse.down();
            await pageA.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 100 });
            await pageA.mouse.up();

            expect(await pageA.locator(".comment-wrapper").count()).toBe(1);
            expect(await pageB.locator(".comment-wrapper").count()).toBe(1);

            // Confirm that the comment position has changed
            const newCommentPosition = await pageA
                .locator(".comment-wrapper")
                .first()
                .evaluate(e => Number(e.parentElement?.getAttribute("top")));
            expect(newCommentPosition - to.x).toBeLessThan(to.height);
        });


        test("Can be resolved", async ({ context }) => {
            const collabOpts = defaultCollabOpts();
            const pageA = await openPageWithOpts(context, collabOpts);
            const pageB = await openPageWithOpts(context, collabOpts);

            // Add a comment from pageA
            const placesForCommentA = await pageA.locator(".comment-gutter-icon").all();
            await placesForCommentA[1].hover();
            await placesForCommentA[1].click();

            // Resolve the comment
            await pageA.locator(".comment-gutter-icon.comment-image").first().hover();
            await pageA.locator('#textarea_id-editor').getByText('RESOLVE').click();

            // Verify that it disappeared from the editor
            expect(await pageA.locator(".comment-wrapper").count()).toBe(0);
            
            // Verify that it appeared in the resolved comments
            await pageA.getByTitle("Resolved Comments").click();
            await pageA.waitForSelector(".resolved-comment");
            expect(await pageA.locator(".resolved-comment").count()).toBe(1);

            // Verify that the resolved comments are synced among peers
            await pageB.getByTitle("Resolved Comments").click();
            await pageB.waitForSelector(".resolved-comment");
            expect(await pageB.locator(".resolved-comment").count()).toBe(1);
        })
    })

})

///////////////////////// UTILITY FUNCTIONS /////////////////////////

const insertToMainEditor = (page: Page, changes: ChangeSpec | null): Promise<void> =>  /** @ts-ignore */
    page.evaluate((changes) => window.myst_editor.main_editor.dispatch({ changes }), changes);

const clearEditor = async (page: Page) => {
    const currentText = await page.evaluate(() => window.myst_editor.text);
    await insertToMainEditor(page, {
        from: 0,
        to: currentText.length,
        insert: "",
    })
}

const defaultCollabOpts = () => ({ collab_server: "ws://localhost:4455", collab: "true", room: Date.now().toString() });

const insertChangesAndCheckOutput = async (page: Page, changes: ChangeSpec | null, check: (html: string) => void | Promise<void>) => {
    await insertToMainEditor(page, changes);
    const preview = await page.locator(".myst-preview").first().innerHTML();
    await check(preview);
}

const openPageWithOpts = async (context: BrowserContext, opts: object) => {
    let query = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => query.set(k, v));
    let page = await context.newPage();
    await page.goto("/?" + query.toString());
    await page.waitForSelector(".cm-content");
    return page;
}